// Collection Optimizer: manually sorted collections read from Shopify, and the proposed order of one
// from the app's statuses and the last 30 days of sales.

import { adminGraphql } from "@/lib/admin";
import { endMoveEffects, startMoveEffects, trackEffect } from "@/lib/collection-effects";
import { movedCount, orderError, proposeOrder, REASONS, sequentialMoves } from "@/lib/collection-order";
import { asDate, DAY_MS } from "@/lib/dates";
import { db } from "@/lib/db";
import { errorMessage, HttpError } from "@/lib/http-error";
import { localDateKey } from "@/lib/jobs/schedule";
import { latestScores } from "@/lib/scores";

/** Collections with more products than this are not reordered here (4 pages of 250). */
export const MAX_COLLECTION_PRODUCTS = 1000;

const COLLECTIONS_QUERY = `#graphql
  query OrderCollections($after: String) {
    collections(first: 250, after: $after, sortKey: TITLE) {
      nodes { id title sortOrder productsCount { count } }
      pageInfo { hasNextPage endCursor }
    }
  }`;

const ORDER_QUERY = `#graphql
  query CollectionOrder($id: ID!, $after: String) {
    collection(id: $id) {
      id title sortOrder
      productsCount { count }
      products(first: 250, after: $after, sortKey: COLLECTION_DEFAULT) { nodes { id } pageInfo { hasNextPage endCursor } }
    }
  }`;

export const collectionGid = (id) => (/^[1-9]\d{0,18}$/.test(String(id)) ? `gid://shopify/Collection/${id}` : null);

/**
 * The shop's collections (up to 2,500): which are sorted manually, and how many products each has.
 * `truncated` when the shop has more.
 */
export async function orderCollections(session) {
  const all = [];
  let after = null;
  do {
    const data = await adminGraphql(session, COLLECTIONS_QUERY, { after });
    all.push(...data.collections.nodes);
    after = data.collections.pageInfo.hasNextPage ? data.collections.pageInfo.endCursor : null;
  } while (after && all.length < 2_500);
  const collections = all.map((c) => {
    const count = c.productsCount?.count ?? 0;
    return { id: c.id, title: c.title, manual: c.sortOrder === "MANUAL", count, tooLarge: count > MAX_COLLECTION_PRODUCTS };
  });
  return { collections, truncated: after != null };
}

/**
 * A collection with its products in their current order (product GIDs). 404 when it's gone; 409 when
 * it isn't sorted manually or is too large to reorder here.
 */
export async function readCollectionOrder(session, gid) {
  let collection = null;
  const productIds = [];
  let after = null;
  do {
    const data = await adminGraphql(session, ORDER_QUERY, { id: gid, after });
    collection = data.collection;
    if (!collection) throw new HttpError("Collection not found.", 404);
    if (collection.sortOrder !== "MANUAL") {
      throw new HttpError("This collection isn't sorted manually in Shopify, so its order can't be changed here.", 409);
    }
    if ((collection.productsCount?.count ?? 0) > MAX_COLLECTION_PRODUCTS) {
      throw new HttpError(`This collection has more than ${MAX_COLLECTION_PRODUCTS.toLocaleString("en")} products, too many to reorder here.`, 409);
    }
    productIds.push(...collection.products.nodes.map((n) => n.id));
    after = collection.products.pageInfo.hasNextPage ? collection.products.pageInfo.endCursor : null;
  } while (after && productIds.length < MAX_COLLECTION_PRODUCTS);
  return { id: collection.id, title: collection.title, productIds };
}

/** What the app knows of each product (by GID): title, status, 30-day revenue, money at stake, can be bought. */
async function productFacts(shop, gids) {
  const products = await db().product.findMany({
    where: { shopId: shop.id, shopifyGid: { in: gids } },
    select: { id: true, shopifyGid: true, title: true, status: true, variants: { select: { inventoryQty: true, sellsWhenOut: true } } },
  });
  const ids = products.map((p) => p.id);
  const today = asDate(localDateKey(new Date(), shop.timezone));
  const [scores, sales] = await Promise.all([
    latestScores(shop.id),
    ids.length
      ? db().productDailyMetric.groupBy({
          by: ["productId"],
          where: { productId: { in: ids }, date: { gte: new Date(today.getTime() - 30 * DAY_MS), lt: today } },
          _sum: { revenue: true },
        })
      : [],
  ]);
  const scoreOf = new Map(scores.map((s) => [s.productId, s]));
  const revenueOf = new Map(sales.map((r) => [r.productId, Number(r._sum.revenue ?? 0)]));
  return new Map(
    products.map((p) => {
      const score = scoreOf.get(p.id);
      const inStock = p.variants.some((v) => v.inventoryQty > 0 || v.sellsWhenOut);
      return [
        p.shopifyGid,
        {
          productId: p.id,
          title: p.title,
          // Not analyzed (over the plan's limit, excluded): no status, so it keeps its place.
          status: score && !["over_limit", "excluded"].includes(score.status) ? score.status : null,
          revenue30: Math.round((revenueOf.get(p.id) ?? 0) * 100) / 100,
          moneyAtStake: score?.moneyAtStake ?? 0,
          active: p.status === "ACTIVE",
          available: p.status === "ACTIVE" && inStock,
        },
      ];
    }),
  );
}

/**
 * The proposed order of a collection: each product in its current place (`from`) and proposed one
 * (`to`), with its group and reason. Products the app doesn't know yet (not synced) keep their place.
 */
export async function proposeCollectionOrder(shop, session, gid) {
  const collection = await readCollectionOrder(session, gid);
  const facts = await productFacts(shop, collection.productIds);
  const items = collection.productIds.map((id) => ({ id, status: null, revenue30: 0, moneyAtStake: 0, available: true, ...facts.get(id) }));
  const byId = new Map(items.map((p) => [p.id, p]));
  const proposal = proposeOrder(items).map((e) => {
    const p = byId.get(e.id);
    return {
      id: e.id,
      productId: p.productId ?? null,
      title: p.title ?? "Product not synced yet",
      status: p.status,
      revenue30: p.revenue30,
      group: e.group,
      reason: REASONS[e.group],
      from: e.from,
      to: e.to,
    };
  });
  return { collection: { id: collection.id, title: collection.title, count: collection.productIds.length }, current: collection.productIds, proposal };
}

// Saving an order: only after the merchant confirms it on the Collections page, with Undo.

/** A save or undo running longer than this has crashed (the slowest real one takes under 2 minutes). */
const IN_PROGRESS_MS = 5 * 60_000;
/** After a save Shopify was still finishing, Undo waits this long (it would find nothing to move yet). */
const SETTLE_MS = 60_000;
const STILL_FINISHING = "Shopify was still finishing it when saved.";
/** Shopify takes up to 250 moves per request. */
const MOVES_PER_REQUEST = 250;
const BUSY = "This collection's order is already being changed.";

const REORDER = `#graphql
  mutation ReorderCollection($id: ID!, $moves: [MoveInput!]!) {
    collectionReorderProducts(id: $id, moves: $moves) { job { id done } userErrors { field message } }
  }`;
const JOB = `#graphql
  query ReorderJob($id: ID!) { job(id: $id) { done } }`;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sameList = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);
/** The database refused a second running change for the collection (partial unique index). */
const isBusyConflict = (error) => error?.code === "P2002";

/** Shopify accepted moves but hadn't finished them in time: they may still be applied. */
class StillApplying extends Error {}

/** Waits for Shopify's reorder job (up to ~20 s); false when it isn't confirmed done in time. */
async function jobDone(session, job) {
  if (!job || job.done) return true;
  for (let i = 0; i < 20; i++) {
    await wait(1000);
    if ((await adminGraphql(session, JOB, { id: job.id })).job?.done) return true;
  }
  return false;
}

/**
 * Moves a collection's products from `current` to `target` order in Shopify (only the products not
 * already in place), 250 moves per request, each request after Shopify's job for the previous one is
 * done (a move's position depends on the moves before it). Throws `StillApplying` when a job isn't
 * confirmed in time (on the last request the order is on its way; on an earlier one the rest wasn't sent).
 */
async function writeOrder(session, gid, current, target) {
  const moves = sequentialMoves(current, target);
  for (let i = 0; i < moves.length; i += MOVES_PER_REQUEST) {
    const r = await adminGraphql(session, REORDER, { id: gid, moves: moves.slice(i, i + MOVES_PER_REQUEST) });
    const errors = r.collectionReorderProducts.userErrors;
    if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
    if (!(await jobDone(session, r.collectionReorderProducts.job))) {
      const last = i + MOVES_PER_REQUEST >= moves.length;
      throw Object.assign(new StillApplying(last ? "Shopify is still applying the new order." : "Shopify was slow applying the new order, so only part of it was sent."), { last });
    }
  }
}

/**
 * A save or undo that crashed (still running after 5 min) is closed: it's kept as applied, so Undo can
 * still restore the order from before it (Shopify may have the new order, part of it, or the old one).
 */
async function closeCrashed(shopId, gid) {
  const stale = new Date(Date.now() - IN_PROGRESS_MS);
  await db().collectionReorder.updateMany({
    where: { shopId, collectionGid: gid, status: "applying", claimedAt: { lt: stale } },
    data: { status: "applied", appliedAt: new Date(), error: "Interrupted: the new order may be only partly saved." },
  });
  await db().collectionReorder.updateMany({
    where: { shopId, collectionGid: gid, status: "undoing", claimedAt: { lt: stale } },
    data: { status: "applied", error: "Undo was interrupted: try again." },
  });
}

const SAVE_FIELDS = { id: true, status: true, error: true, before: true, after: true, appliedAt: true, undoneAt: true, createdAt: true };

/** The last 10 saves of a collection, newest first, with how many products each moved. */
export async function reorderHistory(shopId, gid) {
  await closeCrashed(shopId, gid);
  const rows = await db().collectionReorder.findMany({ where: { shopId, collectionGid: gid }, orderBy: { createdAt: "desc" }, take: 10, select: SAVE_FIELDS });
  return rows.map(({ before, after, ...r }) => ({ ...r, moved: movedCount(before, after) }));
}

/**
 * Each collection's latest saved order (by collection GID): `{ status, error, moved, appliedAt, undoneAt,
 * createdAt, claimedAt }`. Only the newest row per collection is read, and the moved count (places that
 * changed, as `movedCount`) is worked out in the database, so old saves and their product lists stay there.
 */
export async function latestSaves(shopId) {
  const rows = await db().$queryRaw`
    SELECT DISTINCT ON ("collection_gid")
      "collection_gid" AS "collectionGid", "status", "error", "applied_at" AS "appliedAt", "undone_at" AS "undoneAt",
      "created_at" AS "createdAt", "claimed_at" AS "claimedAt",
      (SELECT count(*)::int FROM unnest("before", "after") AS t(b, a) WHERE a IS NOT NULL AND b IS DISTINCT FROM a) AS "moved"
    FROM "collection_reorders"
    WHERE "shop_id" = ${shopId}
    ORDER BY "collection_gid", "created_at" DESC`;
  return new Map(rows.map(({ collectionGid, ...r }) => [collectionGid, r]));
}

/** Collections with saved orders (for a plan without the optimizer: their saves can still be undone). */
export async function savedCollections(shopId) {
  const rows = await db().collectionReorder.findMany({
    where: { shopId },
    distinct: ["collectionGid"],
    orderBy: [{ collectionGid: "asc" }, { createdAt: "desc" }],
    select: { collectionGid: true, collectionTitle: true },
  });
  return rows.map((r) => ({ id: r.collectionGid, title: r.collectionTitle, manual: true, count: null, tooLarge: false }));
}

/**
 * A failed save (always throws). Unchanged in Shopify and not possibly still applying → failed.
 * Otherwise (changed, unknown, or Shopify still has moves to apply) it's kept as applied with what
 * Shopify has now, so Undo can restore the old order.
 */
async function failSave(session, gid, save, live, ids, error) {
  const now = await readCollectionOrder(session, gid).catch(() => null);
  const unchanged = now != null && sameList(now.productIds, live.productIds) && !(error instanceof StillApplying);
  const kept = await db().collectionReorder.update({
    where: { id: save.id },
    data: unchanged
      ? { status: "failed", error: errorMessage(error) }
      : { status: "applied", appliedAt: new Date(), after: now && !sameList(now.productIds, live.productIds) ? now.productIds : ids, error: errorMessage(error) },
  });
  // Partly saved: what moved up is measured too (and undone with the order).
  if (!unchanged) await trackEffect(startMoveEffects(save.shopId, kept));
  throw new HttpError(unchanged ? errorMessage(error) : `Partly saved: ${errorMessage(error)} Reload to see the order, or undo it.`, 502);
}

/**
 * Saves a collection order the merchant confirmed (`order`: the collection's product GIDs, each once).
 * `expected` is the order the page showed: if Shopify's changed since, nothing is written (409). The
 * order Shopify had is kept for Undo. One change per collection at a time (the database enforces it).
 */
export async function saveCollectionOrder(shop, session, gid, { order, expected }) {
  const live = await readCollectionOrder(session, gid);
  if (!Array.isArray(expected) || !sameList(expected, live.productIds)) {
    throw new HttpError("This collection changed in Shopify since the page was opened. Reload and try again.", 409);
  }
  const invalid = orderError(order, live.productIds);
  if (invalid) throw new HttpError(invalid, 400);
  await closeCrashed(shop.id, gid);
  let save;
  try {
    save = await db().collectionReorder.create({
      data: { shopId: shop.id, collectionGid: gid, collectionTitle: live.title, before: live.productIds, after: order },
    });
  } catch (error) {
    if (isBusyConflict(error)) throw new HttpError(BUSY, 409);
    throw error;
  }
  let pending = false;
  try {
    await writeOrder(session, gid, live.productIds, order);
  } catch (error) {
    if (!(error instanceof StillApplying && error.last)) await failSave(session, gid, save, live, order, error);
    pending = true;
  }
  const done = await db().collectionReorder.update({
    where: { id: save.id },
    data: { status: "applied", appliedAt: new Date(), error: pending ? STILL_FINISHING : null },
    select: SAVE_FIELDS,
  });
  // The products moved up into the first places get a rescue plan measuring their sales after the move.
  let measured = 0;
  await trackEffect(startMoveEffects(shop.id, { ...done, collectionGid: gid, collectionTitle: live.title }).then((n) => (measured = n)));
  return { ...done, moved: movedCount(done.before, done.after), pending, measured };
}

/**
 * Puts a collection back in the order it had before a save. If the order changed since (in Shopify or
 * by another save), Undo would overwrite that, so it needs `force`. Products added since stay in the
 * collection (after the restored ones). The save is claimed first, so two undos can't both run.
 */
export async function undoCollectionOrder(shop, session, saveId, { force = false } = {}) {
  const found = await db().collectionReorder.findFirst({ where: { id: String(saveId ?? ""), shopId: shop.id }, select: { id: true, collectionGid: true } });
  if (!found) throw new HttpError("Saved order not found.", 404);
  await closeCrashed(shop.id, found.collectionGid);
  const save = await db().collectionReorder.findUnique({ where: { id: found.id } });
  if (save.status !== "applied") {
    throw new HttpError(save.status === "undone" ? "This order was already undone." : save.status === "failed" ? "This save failed; there's nothing to undo." : BUSY, 409);
  }
  if (save.error === STILL_FINISHING && save.appliedAt > new Date(Date.now() - SETTLE_MS)) {
    throw new HttpError("Shopify is still finishing this order. Try Undo again in a minute.", 409);
  }
  const live = await readCollectionOrder(session, save.collectionGid);
  if (!force && !sameList(live.productIds, save.after)) {
    throw new HttpError("The collection's order changed since this save. Undo anyway to overwrite that change.", 409);
  }
  try {
    const claimed = await db().collectionReorder.updateMany({ where: { id: save.id, status: "applied" }, data: { status: "undoing", claimedAt: new Date(), error: null } });
    if (claimed.count === 0) throw new HttpError("This order is already being undone.", 409);
  } catch (error) {
    if (isBusyConflict(error)) throw new HttpError(BUSY, 409);
    throw error;
  }
  let pending = false;
  try {
    await writeOrder(session, save.collectionGid, live.productIds, save.before);
  } catch (error) {
    if (!(error instanceof StillApplying && error.last)) {
      // Back to applied so it can be tried again; the order may be partly restored.
      await db().collectionReorder.update({ where: { id: save.id }, data: { status: "applied", error: `Undo failed: ${errorMessage(error)}` } });
      throw new HttpError(`Undo failed: ${errorMessage(error)} Reload, then try again.`, 502);
    }
    pending = true;
  }
  const done = await db().collectionReorder.update({ where: { id: save.id }, data: { status: "undone", undoneAt: new Date() }, select: SAVE_FIELDS });
  await trackEffect(endMoveEffects(save.id));
  return { ...done, moved: movedCount(done.before, done.after), pending };
}
