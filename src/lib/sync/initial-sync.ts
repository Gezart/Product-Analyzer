import { adminGraphql } from "@/lib/admin";
import { getOfflineSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { PermanentJobError } from "@/lib/jobs/errors";
import { enqueue, type ClaimedJob } from "@/lib/jobs/queue";
import { localDateKey } from "@/lib/jobs/schedule";
import { bulkStatus, readJsonl, startBulkQuery } from "@/lib/sync/bulk";
import { replaceDailySales, setSyncState, upsertProducts } from "@/lib/sync/store";
import { aggregateOrders, assembleProducts } from "@/lib/sync/transform";

/** Days of order history synced (Shopify's default `read_orders` window). */
export const ORDER_DAYS = 60;
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
const ordersQuery = (since: string) => `{
  orders(query: "created_at:>=${since}") {
    edges { node {
      id createdAt cancelledAt
      lineItems { edges { node { id quantity product { id } discountedTotalSet { shopMoney { amount } } } } }
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

async function startStage(shopId: string, stage: Stage, query: string) {
  const { session } = await shopContext(shopId);
  const operationId = await startBulkQuery(session, query);
  await setSyncState(shopId, stage, { status: "running", error: null, lastCursor: operationId });
  await enqueue({
    type: "sync-poll",
    shopId,
    payload: { stage, operationId, polls: 0 } satisfies PollPayload,
    runAt: new Date(Date.now() + POLL_EVERY_MS),
  });
}

/** Job "initial-sync": stores shop currency/timezone, then starts the products bulk query. */
export async function runInitialSync(job: ClaimedJob) {
  const shopId = requireShop(job);
  const { session } = await shopContext(shopId);
  const { shop } = await adminGraphql<{ shop: { currencyCode: string; ianaTimezone: string } }>(
    session,
    `#graphql
    query ShopInfo { shop { currencyCode ianaTimezone } }`,
  );
  await db().shop.update({ where: { id: shopId }, data: { currency: shop.currencyCode, timezone: shop.ianaTimezone } });
  await setSyncState(shopId, "orders", { status: "pending", error: null });
  await startStage(shopId, "products", PRODUCTS_QUERY);
}

/** Job "sync-poll": waits for a bulk query, stores its result and moves to the next stage. */
export async function runSyncPoll(job: ClaimedJob, signal: AbortSignal) {
  const shopId = requireShop(job);
  const payload = job.payload as PollPayload;
  const { shop, session } = await shopContext(shopId);
  const op = await bulkStatus(session, payload.operationId);

  if (op.status === "CREATED" || op.status === "RUNNING" || op.status === "CANCELING") {
    if (payload.polls >= MAX_POLLS) {
      await setSyncState(shopId, payload.stage, { status: "error", error: "Bulk query took too long" });
      throw new PermanentJobError(`Bulk query ${payload.operationId} took too long`);
    }
    await enqueue({
      type: "sync-poll",
      shopId,
      payload: { ...payload, polls: payload.polls + 1 },
      runAt: new Date(Date.now() + POLL_EVERY_MS),
    });
    return;
  }

  if (op.status !== "COMPLETED") {
    const error = `Bulk query ${op.status.toLowerCase()}${op.errorCode ? ` (${op.errorCode})` : ""}`;
    await setSyncState(shopId, payload.stage, { status: "error", error });
    throw new PermanentJobError(error);
  }

  const rows = await readJsonl(op.url, signal);
  if (payload.stage === "products") {
    await upsertProducts(shopId, assembleProducts(rows));
    await setSyncState(shopId, "products", { status: "done", error: null, lastSyncedAt: new Date() });
    const since = new Date(Date.now() - ORDER_DAYS * 86_400_000);
    await startStage(shopId, "orders", ordersQuery(since.toISOString()));
  } else {
    const fromDate = localDateKey(new Date(Date.now() - ORDER_DAYS * 86_400_000), shop.timezone);
    await replaceDailySales(shopId, fromDate, aggregateOrders(rows, shop.timezone));
    await setSyncState(shopId, "orders", { status: "done", error: null, lastSyncedAt: new Date() });
    await enqueue({ type: "score-shop", shopId });
  }
}
