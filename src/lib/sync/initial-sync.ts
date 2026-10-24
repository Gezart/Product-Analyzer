import { adminGraphql } from "@/lib/admin";
import { getOfflineSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { PermanentJobError } from "@/lib/jobs/errors";
import { enqueue, type ClaimedJob } from "@/lib/jobs/queue";
import { localDateKey } from "@/lib/jobs/schedule";
import { bulkStatus, readJsonl, startBulkQuery } from "@/lib/sync/bulk";
import { isLocalDate, ORDER_DAYS } from "@/lib/sync/constants";
import { applyOrderLines, replaceOrderLines, setSyncState, upsertProducts } from "@/lib/sync/store";
import { assembleProducts, orderLinesFromBulk, type OrderLineRecord } from "@/lib/sync/transform";
import { registerWebhooks } from "@/lib/sync/webhooks";

const POLL_EVERY_MS = 10_000;
const MAX_POLLS = 360; // 1 hour
/** Nightly catch-up re-reads orders changed since the last successful catch-up, minus this margin. */
const CATCHUP_MARGIN_DAYS = 1;

type Stage = "products" | "orders" | "catchup";
/** `startedAt`: when the bulk query started; data changed by webhooks after it is newer than the snapshot. */
type PollPayload = { stage: Stage; operationId: string; polls: number; startedAt: string };

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

// Only dates, cancellation and line items (product, variant, quantity, price) — no customer fields.
const ordersQuery = (filter: string) => `{
  orders(query: "${filter}") {
    edges { node {
      id createdAt updatedAt cancelledAt
      lineItems { edges { node {
        id currentQuantity product { id } variant { id }
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

/** First local day of a fresh order import (date-only filters are read in the shop's timezone). */
function ordersFrom(timeZone: string | null) {
  return localDateKey(new Date(Date.now() - ORDER_DAYS * 86_400_000), timeZone);
}

/**
 * First local day of known order history: the imported window's start once the import is done
 * (kept in the orders step's cursor), otherwise where an import would start. Older orders are ignored,
 * so late webhooks for old orders can't stretch the history.
 */
export async function orderWindowStart(shopId: string, timeZone: string | null) {
  const orders = await db().syncState.findUnique({ where: { shopId_resource: { shopId, resource: "orders" } } });
  return orders?.status === "done" && isLocalDate(orders.lastCursor) ? orders.lastCursor : ordersFrom(timeZone);
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
      if (stage === "orders") await enqueue({ type: "score-shop", shopId: job.shopId });
    }
    throw error;
  }
}

async function startStage(shopId: string, stage: Stage, query: string) {
  // A retried job may have started this stage already (crash after starting): keep that operation.
  // Its first poll is re-scheduled (a no-op if it exists); the start time is unknown, so an earlier
  // one is assumed (safe: only makes more webhook data count as newer than the snapshot).
  const current = await db().syncState.findUnique({ where: { shopId_resource: { shopId, resource: stage } } });
  if (current?.status === "running" && current.lastCursor) {
    const startedAt = new Date(Date.now() - MAX_POLLS * POLL_EVERY_MS).toISOString();
    await schedulePoll(shopId, { stage, operationId: current.lastCursor, polls: 0, startedAt });
    return;
  }
  const { session } = await shopContext(shopId);
  const startedAt = new Date().toISOString();
  const operationId = await startBulkQuery(session, query);
  await setSyncState(shopId, stage, { status: "running", error: null, lastCursor: operationId });
  await schedulePoll(shopId, { stage, operationId, polls: 0, startedAt });
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

/** Job "initial-sync": stores shop currency/timezone, subscribes webhooks, starts the products bulk query. */
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
    // Own job: a registration problem must not block the import.
    await enqueue({ type: "register-webhooks", shopId });
    await startStage(shopId, "products", PRODUCTS_QUERY);
  });
}

/** Job "register-webhooks" (after install and nightly): subscribes the shop to all topics. */
export async function runRegisterWebhooks(job: ClaimedJob) {
  const shopId = requireShop(job);
  try {
    const { session } = await shopContext(shopId);
    await registerWebhooks(session);
    await setSyncState(shopId, "webhooks", { status: "done", error: null, lastSyncedAt: new Date() });
  } catch (error) {
    if (error instanceof PermanentJobError || job.attempts >= job.maxAttempts) {
      const message = error instanceof Error ? error.message : String(error);
      await setSyncState(shopId, "webhooks", { status: "error", error: message.slice(0, 500) });
    }
    throw error;
  }
}

/** Job "orders-catchup" (nightly): re-reads recently changed orders in case webhooks were missed. */
export async function runOrdersCatchup(job: ClaimedJob) {
  const shopId = requireShop(job);
  const orders = await db().syncState.findUnique({ where: { shopId_resource: { shopId, resource: "orders" } } });
  if (orders?.status !== "done") return; // the import covers it
  // From the last successful catch-up (or the import), so longer outages are covered too.
  const catchup = await db().syncState.findUnique({ where: { shopId_resource: { shopId, resource: "catchup" } } });
  const last = (catchup?.status === "done" ? catchup.lastSyncedAt : null) ?? orders.lastSyncedAt ?? new Date();
  const since = new Date(last.getTime() - CATCHUP_MARGIN_DAYS * 86_400_000).toISOString();
  await step(job, "catchup", async () => {
    await startStage(shopId, "catchup", ordersQuery(`updated_at:>='${since}'`));
  });
}

/** Applies catch-up lines order by order; versions already stored (same or newer) are skipped. */
async function applyCatchup(shopId: string, windowStart: string, lines: OrderLineRecord[]) {
  const byOrder = new Map<string, OrderLineRecord[]>();
  for (const line of lines) {
    if (line.date < windowStart) continue;
    byOrder.set(line.orderGid, [...(byOrder.get(line.orderGid) ?? []), line]);
  }
  for (const [orderGid, orderLines] of byOrder) {
    await applyOrderLines(shopId, orderGid, orderLines[0].orderUpdatedAt, orderLines);
  }
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
    // Jobs queued before `startedAt` existed: assume the earliest possible start.
    const snapshotAt = payload.startedAt ? new Date(payload.startedAt) : new Date(Date.now() - MAX_POLLS * POLL_EVERY_MS);
    if (payload.stage === "products") {
      await upsertProducts(shopId, assembleProducts(rows), { snapshotAt });
      await setSyncState(shopId, "products", { status: "done", error: null, lastSyncedAt: new Date() });
      await startStage(shopId, "orders", ordersQuery(`created_at:>='${ordersFrom(shop.timezone)}'`));
    } else if (payload.stage === "orders") {
      // The window start is kept in the cursor: order history is known from that day on.
      const from = ordersFrom(shop.timezone);
      await replaceOrderLines(shopId, from, orderLinesFromBulk(rows, shop.timezone), snapshotAt);
      await setSyncState(shopId, "orders", { status: "done", error: null, lastCursor: from, lastSyncedAt: new Date() });
      await enqueue({ type: "score-shop", shopId });
    } else {
      await applyCatchup(shopId, await orderWindowStart(shopId, shop.timezone), orderLinesFromBulk(rows, shop.timezone));
      await setSyncState(shopId, "catchup", { status: "done", error: null, lastSyncedAt: new Date() });
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
