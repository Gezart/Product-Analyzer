// Bundles (docs/TASKS.md, Phase 3c): a stuck product (dead stock, slow mover) offered with a product
// that sells well, "Buy together −X%", as a Shopify automatic discount (buy the bestseller, get the
// stuck product at X% off) that never takes the stuck product under its price floor. Pure (relative
// imports only) so node:test can load it.

import { daysBetween } from "./dates.js";
import { floorPrice } from "./markdown.js";

export const BUNDLE = {
  /** The discount suggested, when the floor allows it. */
  defaultPct: 15,
  /** Under this the offer isn't worth showing. */
  minPct: 5,
  /** The most the app offers, whatever the floor allows. */
  maxPct: 50,
  /** A partner sells at least this many units in 30 days. */
  minPartnerUnits: 3,
  /** Suggestions shown. */
  shown: 10,
};

/** Statuses of the products a bundle helps, and of the ones that carry it. */
export const STUCK = ["dead_stock", "slow_mover"];
export const SELLING = ["healthy", "stockout_risk"];

const cents = (n) => Math.round(Number(n) * 100);

/**
 * The biggest whole-percent discount that keeps every variant at or above its floor (cost plus the
 * margin floor) and within the store's max discount: `{ pct, reason }` (pct 0 with why when there is none).
 */
export function maxBundlePct(variants, { marginFloorPct, maxDiscountPct }) {
  if (!variants.length) return { pct: 0, reason: "The product has no variants." };
  let pct = Math.min(BUNDLE.maxPct, Math.floor(Number(maxDiscountPct)));
  for (const v of variants) {
    const floor = floorPrice(v.cost == null ? null : Number(v.cost), Number(marginFloorPct));
    if (floor == null) return { pct: 0, reason: "A variant has no unit cost in Shopify, so the lowest safe price is unknown." };
    const price = cents(v.price);
    if (price <= cents(floor)) return { pct: 0, reason: "A variant is already at or below the lowest price your margin allows." };
    // Whole percents only, and checked in cents after Shopify rounds the discount (down to the cent).
    let allowed = Math.floor(((price - cents(floor)) / price) * 100 + 1e-9);
    while (allowed > 0 && Math.floor((price * (100 - allowed)) / 100) < cents(floor)) allowed--;
    pct = Math.min(pct, allowed);
  }
  return pct >= BUNDLE.minPct ? { pct, reason: null } : { pct: 0, reason: `Your margin floor allows less than ${BUNDLE.minPct}% off.` };
}

/** Checks a bundle the merchant asks for: `{ ok, value: { productId, partnerId, pct } }` or `{ ok: false, error }`. */
export function validateBundle(body, maxPct) {
  const { productId, partnerId, pct } = body ?? {};
  if (typeof productId !== "string" || !productId || typeof partnerId !== "string" || !partnerId) return { ok: false, error: "Choose the two products." };
  if (productId === partnerId) return { ok: false, error: "Choose two different products." };
  if (!Number.isInteger(pct) || pct < BUNDLE.minPct || pct > BUNDLE.maxPct) return { ok: false, error: `The discount is ${BUNDLE.minPct}% to ${BUNDLE.maxPct}%.` };
  if (pct > maxPct) return { ok: false, error: maxPct ? `Your margin floor allows up to ${maxPct}% off this product.` : "Your margin floor allows no discount on this product." };
  return { ok: true, value: { productId, partnerId, pct } };
}

/** How many orders had both products, per "stuckGid|partnerGid", from order lines `{ orderGid, productGid }`. */
export function ordersTogether(lines) {
  const orders = new Map();
  for (const l of lines) {
    if (!orders.has(l.orderGid)) orders.set(l.orderGid, new Set());
    orders.get(l.orderGid).add(l.productGid);
  }
  const pairs = new Map();
  for (const products of orders.values()) {
    for (const a of products) for (const b of products) if (a !== b) pairs.set(`${a}|${b}`, (pairs.get(`${a}|${b}`) ?? 0) + 1);
  }
  return pairs;
}

const shared = (a, b) => a.filter((id) => b.includes(id)).length;

/**
 * Bundles to suggest: each stuck product (most money at stake first) with the selling product that
 * fits it best — bought together before, in the same collections, of the same type (one of these at
 * least), most units first — each partner used once, at the default discount or what the floor allows.
 *
 * `products`: `{ id, gid, title, status, rising, stock, units30, moneyAtStake, collections, productType, maxPct, bundled }`
 * (`bundled`: already in a running bundle, either side). Returns `[{ product, partner, pct, why }]`.
 */
export function suggestBundles(products, together = new Map()) {
  const stuck = products
    .filter((p) => STUCK.includes(p.status) && p.stock > 0 && !p.bundled && p.maxPct >= BUNDLE.minPct)
    .sort((a, b) => b.moneyAtStake - a.moneyAtStake || a.id.localeCompare(b.id));
  const partners = products.filter((p) => (SELLING.includes(p.status) || p.rising) && !STUCK.includes(p.status) && p.stock > 0 && !p.bundled && p.units30 >= BUNDLE.minPartnerUnits);
  const used = new Set();
  const out = [];
  for (const product of stuck) {
    let best = null;
    for (const partner of partners) {
      if (used.has(partner.id) || partner.id === product.id) continue;
      const orders = together.get(`${product.gid}|${partner.gid}`) ?? 0;
      const collections = shared(product.collections ?? [], partner.collections ?? []);
      const sameType = Boolean(product.productType && product.productType === partner.productType);
      if (!orders && !collections && !sameType) continue;
      const score = orders * 10 + collections * 3 + (sameType ? 2 : 0) + partner.units30 / 1000;
      if (!best || score > best.score || (score === best.score && partner.id < best.partner.id)) best = { partner, score, orders, collections, sameType };
    }
    if (!best) continue;
    used.add(best.partner.id);
    const why = best.orders
      ? `Bought together in ${best.orders} order${best.orders === 1 ? "" : "s"}`
      : best.collections
        ? "In the same collection"
        : "The same type of product";
    out.push({ product, partner: best.partner, pct: Math.min(BUNDLE.defaultPct, product.maxPct), why: `${why}; ${best.partner.title} sold ${best.partner.units30} in 30 days.` });
    if (out.length >= BUNDLE.shown) break;
  }
  return out;
}

/**
 * What a bundle did since it started (store dates "YYYY-MM-DD"): orders with both products and the
 * stuck product's units and revenue in them, and the stuck product's units a day since vs the 30 days
 * before. `lines`: order lines of the two products `{ orderGid, productGid, date, quantity, revenue }`.
 */
export function bundleEffect(lines, { productGid, partnerGid, startedOn, today }) {
  const byOrder = new Map();
  for (const l of lines) {
    if (l.date < startedOn) continue;
    if (!byOrder.has(l.orderGid)) byOrder.set(l.orderGid, []);
    byOrder.get(l.orderGid).push(l);
  }
  let orders = 0;
  let units = 0;
  let revenue = 0;
  for (const own of byOrder.values()) {
    const stuck = own.filter((l) => l.productGid === productGid && l.quantity > 0);
    if (!stuck.length || !own.some((l) => l.productGid === partnerGid && l.quantity > 0)) continue;
    orders += 1;
    units += stuck.reduce((s, l) => s + l.quantity, 0);
    revenue += stuck.reduce((s, l) => s + Number(l.revenue), 0);
  }
  const days = Math.max(1, daysBetween(startedOn, today));
  const since = lines.filter((l) => l.productGid === productGid && l.date >= startedOn).reduce((s, l) => s + l.quantity, 0);
  const before = lines.filter((l) => l.productGid === productGid && l.date < startedOn && daysBetween(l.date, startedOn) <= 30).reduce((s, l) => s + l.quantity, 0);
  return { orders, units, revenue: Math.round(revenue * 100) / 100, days, perDaySince: since / days, perDayBefore: before / 30 };
}

/** Whether a running bundle must end now, and why: the stuck product sold out, a product is gone, or the floor moved. */
export function endReason({ productActive, partnerActive, stock, maxPct, pct, included }) {
  if (!included) return "plan";
  if (!productActive || !partnerActive) return "product_gone";
  if (stock <= 0) return "sold_out";
  if (maxPct < pct) return "floor";
  return null;
}

export const END_REASONS = {
  stopped: "Ended",
  sold_out: "Sold out",
  product_gone: "A product was removed",
  floor: "Its price floor changed",
  plan: "Your plan no longer includes bundles",
};
