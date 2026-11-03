// Returns: refunded units per order line and why items came back. Bulk operations can't read refund
// lines (a connection inside a list field) or return lines (three levels deep), so only the orders
// that have refunds or returns are read, a few per request, using Shopify's order search.

import { adminGraphql } from "@/lib/admin";
import { getOfflineSession } from "@/lib/auth";
import { DAY_MS } from "@/lib/dates";
import { db } from "@/lib/db";
import { PermanentJobError } from "@/lib/jobs/errors";
import { enqueue } from "@/lib/jobs/queue";
import { isAccessDenied, isThrottled } from "@/lib/sync/graphql-errors";
import { orderWindowStart } from "@/lib/sync/initial-sync";
import { pruneReturns, replaceOrderRefunds, replaceOrderReturnReasons, setSyncState } from "@/lib/sync/store";
import { lineRefundsFromOrder, REFUNDED_SEARCH, RETURNED_SEARCH, returnReasonsFromOrder, returnsSearch } from "@/lib/sync/transform";

/** Re-reads orders updated since the last read minus this margin (late or retried writes). */
const MARGIN_DAYS = 1;
/** A run reads for this long (jobs time out at 5 min), then a follow-up run continues where it stopped. */
const RUN_BUDGET_MS = 3 * 60 * 1000;
const MAX_ROUNDS = 30;
const THROTTLE_RETRIES = 5;

// Query costs stay under Shopify's 1,000-point limit per request (a connection costs 2 + first × its
// node, an object 1): orders 3 × refunds 3 × lines 10 ≈ 480; returns likewise ≈ 490. Orders with more
// refunds, returns or lines than fit are completed with the queries below.
const REFUND_LINE = "quantity restockType subtotalSet { shopMoney { amount } } lineItem { id product { id } }";
const RETURN_LINE = "... on ReturnLineItem { id quantity returnReason returnReasonDefinition { handle name } fulfillmentLineItem { lineItem { id product { id } } } }";
const PAGE = "pageInfo { hasNextPage endCursor }";

const REFUNDS_QUERY = `#graphql
  query RefundedOrders($query: String!, $after: String) {
    orders(first: 3, after: $after, query: $query, sortKey: UPDATED_AT) {
      nodes { id createdAt updatedAt refunds(first: 3) { id refundLineItems(first: 10) { nodes { ${REFUND_LINE} } ${PAGE} } } }
      ${PAGE}
    }
  }`;
const REFUND_IDS_QUERY = `#graphql
  query OrderRefundIds($id: ID!) { order(id: $id) { refunds(first: 100) { id } } }`;
const REFUND_LINES_QUERY = `#graphql
  query RefundLines($id: ID!, $after: String) { refund(id: $id) { refundLineItems(first: 50, after: $after) { nodes { ${REFUND_LINE} } ${PAGE} } } }`;

const RETURNS_QUERY = `#graphql
  query ReturnedOrders($query: String!, $after: String) {
    orders(first: 3, after: $after, query: $query, sortKey: UPDATED_AT) {
      nodes { id createdAt updatedAt returns(first: 3) { nodes { id status returnLineItems(first: 10) { nodes { ${RETURN_LINE} } ${PAGE} } } ${PAGE} } }
      ${PAGE}
    }
  }`;
const RETURN_IDS_QUERY = `#graphql
  query OrderReturnIds($id: ID!, $after: String) { order(id: $id) { returns(first: 50, after: $after) { nodes { id status } ${PAGE} } } }`;
const RETURN_LINES_QUERY = `#graphql
  query ReturnLines($id: ID!, $after: String) { return(id: $id) { returnLineItems(first: 50, after: $after) { nodes { ${RETURN_LINE} } ${PAGE} } } }`;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Thrown when the run's time is up; the progress so far is kept and a follow-up run continues. */
class OutOfTime extends Error {}

/** A request that waits and retries while Shopify throttles the app. */
async function request(session, query, variables, signal) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await adminGraphql(session, query, variables);
    } catch (error) {
      if (!isThrottled(error) || attempt >= THROTTLE_RETRIES || signal?.aborted) throw error;
      await wait(2000 * (attempt + 1));
    }
  }
}

/** Every page of a connection reached through `pick(data)`. */
async function allPages(session, query, variables, pick, signal) {
  const nodes = [];
  let after = null;
  do {
    const conn = pick(await request(session, query, { ...variables, after }, signal));
    if (!conn) break;
    nodes.push(...conn.nodes);
    after = conn.pageInfo?.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (after && !signal?.aborted);
  return nodes;
}

/** The order with all its refunds and refund lines (the first read holds at most 3 × 10). */
async function completeRefunds(session, order, signal) {
  const cut = order.refunds.length >= 3 || order.refunds.some((r) => r.refundLineItems?.pageInfo?.hasNextPage);
  if (!cut) return order;
  const ids = (await request(session, REFUND_IDS_QUERY, { id: order.id }, signal)).order?.refunds ?? [];
  const refunds = [];
  for (const { id } of ids) {
    refunds.push({ refundLineItems: { nodes: await allPages(session, REFUND_LINES_QUERY, { id }, (d) => d.refund?.refundLineItems, signal) } });
  }
  return { ...order, refunds };
}

/** The order with all its returns and return lines (the first read holds at most 3 × 10). */
async function completeReturns(session, order, signal) {
  const cut = order.returns?.pageInfo?.hasNextPage || order.returns?.nodes?.some((r) => r.returnLineItems?.pageInfo?.hasNextPage);
  if (!cut) return order;
  const all = await allPages(session, RETURN_IDS_QUERY, { id: order.id }, (d) => d.order?.returns, signal);
  const nodes = [];
  for (const r of all) {
    if (r.status === "DECLINED" || r.status === "CANCELED") continue; // they don't count: no need for their lines
    nodes.push({ ...r, returnLineItems: { nodes: await allPages(session, RETURN_LINES_QUERY, { id: r.id }, (d) => d.return?.returnLineItems, signal) } });
  }
  return { ...order, returns: { nodes } };
}

/**
 * Every order of a search, oldest update first, through `onOrder`. Stops with `OutOfTime` after the
 * run's budget, having recorded in `progress.reached` the last update fully handled.
 */
async function eachOrder(session, query, search, onOrder, progress, signal) {
  let after = null;
  do {
    if (Date.now() > progress.deadline) throw new OutOfTime();
    const data = await request(session, query, { query: search, after }, signal);
    for (const order of data.orders.nodes) {
      if (signal?.aborted) return;
      await onOrder(order);
      progress.reached = order.updatedAt ?? progress.reached;
    }
    after = data.orders.pageInfo.hasNextPage ? data.orders.pageInfo.endCursor : null;
  } while (after && !signal?.aborted);
}

/** Where a read starts: where an unfinished run stopped, else the last read minus a day, else the window. */
function startOf(state, windowStart) {
  if (state?.status === "partial" && state.lastCursor) return state.lastCursor;
  if (state?.status === "done" && state.lastSyncedAt) return new Date(state.lastSyncedAt.getTime() - MARGIN_DAYS * DAY_MS).toISOString();
  return windowStart; // first read, or reasons the app couldn't read yet: the whole window
}

const state = (shopId, resource) => db().syncState.findUnique({ where: { shopId_resource: { shopId, resource } } });
const numericId = (gid) => gid.split("/").pop();

/**
 * Job "returns-sync" (nightly, and after the first import): refunds and return reasons of orders in the
 * order window that changed since the last read, each with its own progress. Return reasons need
 * `read_returns`: until the merchant approves it they are skipped (refunds are still read) and read for
 * the whole window once it's there. A run that takes too long continues in a follow-up run.
 */
export async function runReturnsSync(job, signal, { budgetMs = RUN_BUDGET_MS } = {}) {
  const shopId = job.shopId;
  if (!shopId) throw new PermanentJobError("returns-sync needs a shop");
  const shop = await db().shop.findUnique({ where: { id: shopId } });
  if (!shop || shop.uninstalledAt) return;
  const orders = await state(shopId, "orders");
  if (orders?.status !== "done") return; // the import isn't in yet; it queues this job when done
  const session = await getOfflineSession(shop.domain);
  const windowStart = await orderWindowStart(shopId, shop.timezone);
  const startedAt = new Date();
  const progress = { deadline: Date.now() + budgetMs, reached: null };

  const phase = async (resource, run) => {
    progress.reached = null;
    try {
      await run(startOf(await state(shopId, resource), windowStart));
      if (signal?.aborted) return "stopped";
      await setSyncState(shopId, resource, { status: "done", error: null, lastCursor: null, lastSyncedAt: startedAt });
      return "done";
    } catch (error) {
      if (error instanceof OutOfTime) {
        if (progress.reached) await setSyncState(shopId, resource, { status: "partial", lastCursor: progress.reached });
        return "partial";
      }
      if (resource === "return_reasons" && isAccessDenied(error)) {
        await setSyncState(shopId, resource, {
          status: "no_scope",
          error: "Return reasons need the read_returns permission (approve the app update in Shopify).",
          lastCursor: null,
        });
        return "no_scope";
      }
      throw error;
    }
  };

  const refunds = await phase("returns", (since) =>
    eachOrder(session, REFUNDS_QUERY, returnsSearch(REFUNDED_SEARCH, windowStart, since), async (order) => {
      const full = await completeRefunds(session, order, signal);
      if (signal?.aborted) return; // possibly incomplete: the next run reads this order again
      await replaceOrderRefunds(shopId, order.id, new Date(order.updatedAt ?? order.createdAt), lineRefundsFromOrder(full, shop.timezone));
    }, progress, signal),
  );

  let reasons = "skipped";
  if (refunds !== "partial" && refunds !== "stopped") {
    reasons = await phase("return_reasons", async (since) => {
      const seen = new Set();
      const store = async (order) => {
        seen.add(order.id);
        const full = await completeReturns(session, order, signal);
        if (signal?.aborted) return; // possibly incomplete: the next run reads this order again
        await replaceOrderReturnReasons(shopId, order.id, new Date(order.updatedAt ?? order.createdAt), returnReasonsFromOrder(full, shop.timezone));
      };
      await eachOrder(session, RETURNS_QUERY, returnsSearch(RETURNED_SEARCH, windowStart, since), store, progress, signal);
      // Returns still requested or open can be declined or cancelled, and their order then leaves that
      // search: re-read those orders if they changed, so their reasons are cleared. (Its own progress:
      // where it stops says nothing about the main search's.)
      const open = await db().returnReason.findMany({ where: { shopId, returnStatus: { in: ["REQUESTED", "OPEN"] } }, distinct: ["orderGid"], select: { orderGid: true } });
      const recheck = open.map((r) => r.orderGid).filter((id) => !seen.has(id));
      const recheckProgress = { deadline: progress.deadline, reached: null };
      // Out of time during the re-check: the reasons' start doesn't move, so the follow-up re-checks all.
      progress.reached = null;
      for (let i = 0; i < recheck.length && !signal?.aborted; i += 20) {
        const ids = recheck.slice(i, i + 20).map((gid) => `id:${numericId(gid)}`).join(" OR ");
        await eachOrder(session, RETURNS_QUERY, `(${ids}) AND updated_at:>='${since}'`, store, recheckProgress, signal);
      }
    });
  }

  if (refunds === "partial" || reasons === "partial") {
    const round = Number(job.payload?.round ?? 0);
    if (round < MAX_ROUNDS) await enqueue({ type: "returns-sync", shopId, payload: { round: round + 1 }, uniqueKey: `returns-sync:more:${job.id}` });
    return;
  }
  if (refunds === "done") await pruneReturns(shopId, windowStart);
}
