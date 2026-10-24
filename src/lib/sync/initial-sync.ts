import { adminGraphql } from "@/lib/admin";
import { getOfflineSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { PermanentJobError } from "@/lib/jobs/errors";
import { enqueue, type ClaimedJob } from "@/lib/jobs/queue";
import { localDateKey } from "@/lib/jobs/schedule";
import { bulkStatus, readJsonl, startBulkQuery } from "@/lib/sync/bulk";
import { ORDER_DAYS } from "@/lib/sync/constants";
import { replaceDailySales, setSyncState, upsertProducts } from "@/lib/sync/store";
import { aggregateOrders, assembleProducts } from "@/lib/sync/transform";

const POLL_EVERY_MS = 10_000;
const MAX_POLLS = 360; // 1 hour

type Stage = "products" | "orders";
type PollPayload = { stage: Stage; operationId: string; polls: number };

const PRODUCTS_QUERY = `{
  products {
    edges { node {
      id title handle productType vendor status createdAt description
      mediaCount { count }
      collections { edges { node { id } } }
      variants { edges { node {
        id sku price compareAtPrice inventoryQuantity
        selectedOptions { name value }
        inventoryItem { unitCost { amount } }
      } } }
    } }
  }
}`;

// Only date, cancellation and line items (product, quantity, price) — no customer fields.
// `since` is a local date; Shopify reads date-only filters in the shop's timezone.
const ordersQuery = (since: string) => `{
  orders(query: "created_at:>='${since}'") {
    edges { node {
      id createdAt cancelledAt
      lineItems { edges { node {
        id currentQuantity product { id }
        discountedUnitPriceAfterAllDiscountsSet { shopMoney { amount } }
      } } }
    } }
  }
}`;

async function shopContext(shopId: string) {
  const shop = await db().shop.findUnique({ where: { id: shopId } });
  if (!shop || shop.uninstalledAt) throw new PermanentJobError("Shop not installed");
  return { shop, session: await getOfflineSession(shop.domain) };
}

function requireShop(job: ClaimedJob) {
  if (!job.shopId) throw new PermanentJobError(`${job.type} needs a shop`);
  return job.shopId;
}

/** First local day of the synced order window. */
function ordersFrom(timeZone: string | null) {
  return localDateKey(new Date(Date.now() - ORDER_DAYS * 86_400_000), timeZone);
}

/**
 * Runs a sync step; when it fails for good (permanent error or last attempt) the step is marked
 * "error" so the page stops waiting and offers a retry. If products fail, orders are skipped;
 * if orders fail, the catalog is still scored with what was stored.
 */
async function step(job: ClaimedJob, stage: Stage, run: () => Promise<void>) {
  try {
    await run();
  } catch (error) {
    if (error instanceof PermanentJobError || job.attempts >= job.maxAttempts) {
      const message = error instanceof Error ? error.message : String(error);
      await setSyncState(job.shopId!, stage, { status: "error", error: message.slice(0, 500) });
      if (stage === "products") await setSyncState(job.shopId!, "orders", { status: "error", error: "Skipped" });
      else await enqueue({ type: "score-shop", shopId: job.shopId });
    }
    throw error;
  }
}

async function startStage(shopId: string, stage: Stage, query: string) {
  // A retried job may have started this stage already (crash after starting): keep that operation.
  // Re-scheduling its first poll is a no-op when that poll already exists (same unique key).
  const current = await db().syncState.findUnique({ where: { shopId_resource: { shopId, resource: stage } } });
  if (current?.status === "running" && current.lastCursor) {
    await schedulePoll(shopId, { stage, operationId: current.lastCursor, polls: 0 });
    return;
  }
  const { session } = await shopContext(shopId);
  const operationId = await startBulkQuery(session, query);
  await setSyncState(shopId, stage, { status: "running", error: null, lastCursor: operationId });
  await schedulePoll(shopId, { stage, operationId, polls: 0 });
}

// The key stops a retried job from starting a second poll chain for the same operation.
async function schedulePoll(shopId: string, payload: PollPayload) {
  await enqueue({
    type: "sync-poll",
    shopId,
    payload,
    runAt: new Date(Date.now() + POLL_EVERY_MS),
    uniqueKey: `sync-poll:${payload.operationId}:${payload.polls}`,
  });
}

/** Job "initial-sync": stores shop currency/timezone, then starts the products bulk query. */
export async function runInitialSync(job: ClaimedJob) {
  const shopId = requireShop(job);
  await step(job, "products", async () => {
    const { session } = await shopContext(shopId);
    const { shop } = await adminGraphql<{ shop: { currencyCode: string; ianaTimezone: string } }>(
      session,
      `#graphql
      query ShopInfo { shop { currencyCode ianaTimezone } }`,
    );
    await db().shop.update({ where: { id: shopId }, data: { currency: shop.currencyCode, timezone: shop.ianaTimezone } });
    await startStage(shopId, "products", PRODUCTS_QUERY);
  });
}

/** Job "sync-poll": waits for a bulk query, stores its result and moves to the next stage. */
export async function runSyncPoll(job: ClaimedJob, signal: AbortSignal) {
  const shopId = requireShop(job);
  const payload = job.payload as PollPayload;
  await step(job, payload.stage, async () => {
    const { shop, session } = await shopContext(shopId);
    const op = await bulkStatus(session, payload.operationId);

    if (op.status === "CREATED" || op.status === "RUNNING" || op.status === "CANCELING") {
      if (payload.polls >= MAX_POLLS) throw new PermanentJobError("Bulk query took too long");
      await schedulePoll(shopId, { ...payload, polls: payload.polls + 1 });
      return;
    }
    if (op.status !== "COMPLETED") {
      throw new PermanentJobError(`Bulk query ${op.status.toLowerCase()}${op.errorCode ? ` (${op.errorCode})` : ""}`);
    }

    const rows = await readJsonl(op.url, signal);
    if (payload.stage === "products") {
      await upsertProducts(shopId, assembleProducts(rows));
      await setSyncState(shopId, "products", { status: "done", error: null, lastSyncedAt: new Date() });
      await startStage(shopId, "orders", ordersQuery(ordersFrom(shop.timezone)));
    } else {
      await replaceDailySales(shopId, ordersFrom(shop.timezone), aggregateOrders(rows, shop.timezone));
      await setSyncState(shopId, "orders", { status: "done", error: null, lastSyncedAt: new Date() });
      await enqueue({ type: "score-shop", shopId });
    }
  });
}

const SYNC_JOB_TYPES = ["initial-sync", "sync-poll"];

/**
 * Restarts the import after a failure. A step left "running"/"pending" with no sync job alive
 * (worker crash on the last try) counts as failed. The products step row is locked for the
 * check-and-enqueue, so parallel requests start at most one import. Returns false when a sync is
 * still in progress.
 */
export async function retryInitialSync(shopId: string) {
  await db().syncState.createMany({
    data: ["products", "orders"].map((resource) => ({ shopId, resource, status: "error" })),
    skipDuplicates: true,
  });
  return db().$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT 1 FROM "sync_state" WHERE "shop_id" = ${shopId} AND "resource" = 'products' FOR UPDATE
    `;
    const active = await tx.job.count({
      where: { shopId, type: { in: SYNC_JOB_TYPES }, status: { in: ["queued", "running"] } },
    });
    if (active > 0) return false;
    await tx.syncState.updateMany({
      where: { shopId, resource: { in: ["products", "orders"] } },
      data: { status: "pending", error: null, lastCursor: null },
    });
    await tx.job.create({ data: { type: "initial-sync", shopId, uniqueKey: `initial-sync:${shopId}:retry:${Date.now()}` } });
    return true;
  });
}
