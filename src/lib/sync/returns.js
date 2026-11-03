// Returns: refunded units per order line and why items came back. Bulk operations can't read refund
// lines (a connection inside a list field) or return lines (three levels deep), so only the orders
// that have refunds or returns are read, a few per request, using Shopify's order search.

import { adminGraphql } from "@/lib/admin";
import { getOfflineSession } from "@/lib/auth";
import { DAY_MS } from "@/lib/dates";
import { db } from "@/lib/db";
import { PermanentJobError } from "@/lib/jobs/errors";
import { orderWindowStart } from "@/lib/sync/initial-sync";
import { pruneReturns, replaceOrderRefunds, replaceOrderReturnReasons, setSyncState } from "@/lib/sync/store";
import { lineRefundsFromOrder, returnReasonsFromOrder } from "@/lib/sync/transform";

/** Re-reads orders updated since the last read minus this margin (late or retried writes). */
const MARGIN_DAYS = 1;
const MAX_PAGES = 400; // 2,000 orders a night
const THROTTLE_RETRIES = 5;

// Small pages keep each request under Shopify's query cost limit (5 orders × 5 refunds × 20 lines).
const REFUNDS_QUERY = `#graphql
  query RefundedOrders($query: String!, $after: String) {
    orders(first: 5, after: $after, query: $query, sortKey: UPDATED_AT) {
      nodes {
        id createdAt updatedAt
        refunds(first: 5) {
          refundLineItems(first: 20) {
            nodes { quantity restockType subtotalSet { shopMoney { amount } } lineItem { id product { id } } }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`;

const RETURNS_QUERY = `#graphql
  query ReturnedOrders($query: String!, $after: String) {
    orders(first: 5, after: $after, query: $query, sortKey: UPDATED_AT) {
      nodes {
        id createdAt updatedAt
        returns(first: 5) {
          nodes {
            returnLineItems(first: 20) {
              nodes {
                ... on ReturnLineItem {
                  id quantity returnReason
                  returnReasonDefinition { handle name }
                  fulfillmentLineItem { lineItem { id product { id } } }
                }
              }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`;

const REFUNDED = "(financial_status:refunded OR financial_status:partially_refunded)";
const RETURNED = "(return_status:return_requested OR return_status:in_progress OR return_status:inspection_complete OR return_status:returned)";

/** The orders search: these orders, created in the window, updated since `since`. */
export function returnsSearch(filter, windowStart, since) {
  return `${filter} AND created_at:>='${windowStart}' AND updated_at:>='${since}'`;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A request that waits and retries when Shopify answers THROTTLED (a GraphQL error with HTTP 200). */
async function request(session, query, variables, signal) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await adminGraphql(session, query, variables);
    } catch (error) {
      if (!/THROTTLED/.test(String(error?.message)) || attempt >= THROTTLE_RETRIES || signal?.aborted) throw error;
      await wait(2000 * (attempt + 1));
    }
  }
}

/** Every page of a search, calling `onOrder` for each order. */
async function eachOrder(session, query, search, onOrder, signal) {
  let after = null;
  for (let page = 0; page < MAX_PAGES && !signal?.aborted; page++) {
    const data = await request(session, query, { query: search, after }, signal);
    for (const order of data.orders.nodes) await onOrder(order);
    if (!data.orders.pageInfo.hasNextPage) return;
    after = data.orders.pageInfo.endCursor;
  }
}

/** The app doesn't have `read_returns` yet (the merchant hasn't approved the new scope). */
const missingScope = (error) => /ACCESS_DENIED|read_returns|access scope/i.test(String(error?.message));

/**
 * Job "returns-sync" (nightly, and after the first import): refunds and return reasons of orders in the
 * order window that changed since the last read. Return reasons need `read_returns`; without it they are
 * skipped and the refunds are still read.
 */
export async function runReturnsSync(job, signal) {
  const shopId = job.shopId;
  if (!shopId) throw new PermanentJobError("returns-sync needs a shop");
  const shop = await db().shop.findUnique({ where: { id: shopId } });
  if (!shop || shop.uninstalledAt) return;
  const orders = await db().syncState.findUnique({ where: { shopId_resource: { shopId, resource: "orders" } } });
  if (orders?.status !== "done") return; // the import isn't in yet; it queues this job when done
  const session = await getOfflineSession(shop.domain);
  const windowStart = await orderWindowStart(shopId, shop.timezone);
  const state = await db().syncState.findUnique({ where: { shopId_resource: { shopId, resource: "returns" } } });
  const since = state?.status === "done" && state.lastSyncedAt ? new Date(state.lastSyncedAt.getTime() - MARGIN_DAYS * DAY_MS).toISOString() : windowStart;
  const startedAt = new Date();

  await eachOrder(session, REFUNDS_QUERY, returnsSearch(REFUNDED, windowStart, since), async (order) => {
    await replaceOrderRefunds(shopId, order.id, new Date(order.updatedAt ?? order.createdAt), lineRefundsFromOrder(order, shop.timezone));
  }, signal);

  let reasons = "done";
  try {
    await eachOrder(session, RETURNS_QUERY, returnsSearch(RETURNED, windowStart, since), async (order) => {
      await replaceOrderReturnReasons(shopId, order.id, new Date(order.updatedAt ?? order.createdAt), returnReasonsFromOrder(order, shop.timezone));
    }, signal);
  } catch (error) {
    if (!missingScope(error)) throw error;
    reasons = "no_scope";
  }
  if (signal?.aborted) return; // the next run reads from the same point

  await pruneReturns(shopId, windowStart);
  await setSyncState(shopId, "returns", {
    status: "done",
    // Kept for the settings/sync page: reasons aren't read until the merchant approves `read_returns`.
    error: reasons === "no_scope" ? "Return reasons need the read_returns permission (approve the app update in Shopify)." : null,
    lastSyncedAt: startedAt,
  });
}
