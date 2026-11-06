// A/B tests (docs/TASKS.md, Phase 3b): half the visitors of a product page see version B of its title,
// description or photo order, at the same time as the other half see the page as it is (A). Pure
// (relative imports only) so node:test can load it.

import { DAY_MS, round2 } from "./dates.js";
import { sameState, validateFix } from "./fixes.js";

export const KINDS = ["title", "description", "images"];

export const KIND_LABELS = { title: "Title", description: "Description", images: "Photos" };

/**
 * When a test stops: once each version has `minVisitors` and it ran `minDays` (a full week), at a
 * `threshold` chance either way; otherwise after `maxDays`. The chance is on add-to-carts per visitor.
 */
export const RULES = { minVisitors: 100, minDays: 7, maxDays: 30, threshold: 0.95 };

/** The storefront reads version B from a JSON metafield; Shopify caps those at 128 KB. */
export const MAX_METAFIELD_BYTES = 120_000;

/** Line item property the storefront adds to the tested product's "Add to cart" (`<testId>:<visitorId>`). */
export const LINE_PROPERTY = "_unstuck_ab";

const VISITOR = /^[0-9a-f]{32}$/;
const TEST_ID = /^[a-z0-9]{20,40}$/;

export const isVisitorId = (value) => typeof value === "string" && VISITOR.test(value);
export const isTestId = (value) => typeof value === "string" && TEST_ID.test(value);

/**
 * 32-bit hash of a string (FNV-1a, then murmur3's finalizer so every bit mixes). The storefront script
 * (extensions/unstuck-storefront/assets/unstuck-ab.js) has the same function: both must agree.
 */
export function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** The version a visitor sees: fixed per test and visitor, half "a" and half "b". */
export function variantOf(testId, visitorId) {
  return hash32(`${testId}:${visitorId}`) % 2 === 1 ? "b" : "a";
}

const plainText = (html) =>
  String(html ?? "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** A short plain-text preview of a description (for the list of tests). */
export function textPreview(html, max = 140) {
  const text = plainText(html);
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * Checks version B against the product as it is (A): `{ ok: true, b }` or `{ ok: false, error }`.
 * `a` is the live state for the kind (as the fix center reads it); `mediaTypes` the live media's types.
 * Photos: B is a new order of the same photos (only products whose media are all photos, at least 2).
 * Description: A can't be empty (the storefront finds it on the page by its text).
 */
export function validateTest(kind, rawB, { a, mediaTypes = [] }) {
  if (!KINDS.includes(kind)) return { ok: false, error: "Choose a title, description or photos test." };
  const valid = validateFix(kind, rawB);
  if (!valid.ok) return { ok: false, error: valid.error };
  const b = valid.after;
  if (sameState(kind, a, b)) return { ok: false, error: "Version B is the same as the page now. Change something first." };

  if (kind === "description") {
    if (!plainText(a.descriptionHtml)) return { ok: false, error: "The product has no description yet. Add one in the fix center first; the test needs it to find on the page." };
    if (!plainText(b.descriptionHtml)) return { ok: false, error: "Version B's description is empty." };
    if (new TextEncoder().encode(b.descriptionHtml).length > MAX_METAFIELD_BYTES) return { ok: false, error: "Version B's description is too long for a test (about 100,000 characters at most)." };
  }
  if (kind === "images") {
    if (mediaTypes.length < 2) return { ok: false, error: "A photos test needs at least 2 photos." };
    if (mediaTypes.some((t) => t !== "IMAGE")) return { ok: false, error: "Photos tests work on products with photos only (no videos or 3D models)." };
    const now = [...a.mediaIds].sort();
    const next = [...b.mediaIds].sort();
    if (now.length !== next.length || now.some((id, i) => id !== next[i])) return { ok: false, error: "Version B must use the product's photos, in a new order." };
  }
  return { ok: true, b };
}

const numericId = (gid) => Number(String(gid).split("/").pop());

/** What the storefront reads from the product's `$app.ab_test` metafield: the test and its version B. */
export function storefrontValue(test) {
  const base = { id: test.id, kind: test.kind };
  if (test.kind === "title") return { ...base, title: test.b.title };
  if (test.kind === "description") return { ...base, description_html: test.b.descriptionHtml };
  return { ...base, media_ids: test.b.mediaIds.map(numericId) };
}

// ── Chance B is better ─────────────────────────────────────────────────────────

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** ln Γ(x) for x > 0 (Lanczos, g = 7). */
export function logGamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const z = x - 1;
  let sum = LANCZOS[0];
  for (let i = 1; i < 9; i++) sum += LANCZOS[i] / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(sum);
}

const logBeta = (a, b) => logGamma(a) + logGamma(b) - logGamma(a + b);

/**
 * The chance that B's rate is really higher than A's, from `{ visitors, hits }` of each (Bayesian,
 * uniform prior: each rate ~ Beta(1 + hits, 1 + misses); exact sum, Evan Miller's formula).
 * Null without visitors on both sides.
 */
export function chanceBBetter(a, b) {
  if (!a.visitors || !b.visitors) return null;
  const hitsA = Math.min(a.hits, a.visitors);
  const hitsB = Math.min(b.hits, b.visitors);
  const alphaA = 1 + hitsA;
  const betaA = 1 + a.visitors - hitsA;
  const alphaB = 1 + hitsB;
  const betaB = 1 + b.visitors - hitsB;
  const base = logBeta(alphaA, betaA);
  let total = 0;
  for (let i = 0; i < alphaB; i++) {
    total += Math.exp(logBeta(alphaA + i, betaA + betaB) - Math.log(betaB + i) - logBeta(1 + i, betaB) - base);
  }
  return Math.min(1, Math.max(0, total));
}

const EMPTY = { visitors: 0, carts: 0, buyers: 0, units: 0, revenue: 0 };

/** One version's numbers with its rates (null without visitors). */
function withRates(side = EMPTY) {
  const s = { ...EMPTY, ...side, revenue: round2(side.revenue ?? 0) };
  return {
    ...s,
    cartRate: s.visitors ? s.carts / s.visitors : null,
    conversion: s.visitors ? s.buyers / s.visitors : null,
    revenuePerVisitor: s.visitors ? round2(s.revenue / s.visitors) : null,
  };
}

/** Both versions' numbers and the chance B is better (on add-to-carts per visitor). */
export function testStats(counts = {}) {
  const a = withRates(counts.a);
  const b = withRates(counts.b);
  return { a, b, chance: chanceBBetter({ visitors: a.visitors, hits: a.carts }, { visitors: b.visitors, hits: b.carts }) };
}

/** Days a test has run (whole days). */
export const daysRunning = (startedAt, now) => Math.max(0, Math.floor((now.getTime() - new Date(startedAt).getTime()) / DAY_MS));

/**
 * Whether a running test is over: `{ ended: false }`, or `{ ended: true, reason, winner }` with reason
 * "b_better" or "a_better" (the chance passed the threshold with enough visitors and days) or "time"
 * (30 days; the winner then only if the chance is clear, else null).
 */
export function decide(startedAt, stats, now = new Date(), rules = RULES) {
  const days = (now.getTime() - new Date(startedAt).getTime()) / DAY_MS;
  const { chance } = stats;
  const clear = chance == null ? null : chance >= rules.threshold ? "b" : chance <= 1 - rules.threshold ? "a" : null;
  const enough = stats.a.visitors >= rules.minVisitors && stats.b.visitors >= rules.minVisitors && days >= rules.minDays;
  if (enough && clear) return { ended: true, reason: clear === "b" ? "b_better" : "a_better", winner: clear };
  if (days >= rules.maxDays) return { ended: true, reason: "time", winner: enough ? clear : null };
  return { ended: false };
}

// ── Purchases from orders ─────────────────────────────────────────────────────

/** `{ testId, visitorId }` from the line item property's value, or null when it isn't ours. */
export function parseLineProperty(value) {
  const [testId, visitorId, extra] = String(value ?? "").split(":");
  if (extra !== undefined || !isTestId(testId) || !isVisitorId(visitorId)) return null;
  return { testId, visitorId };
}

const tagged = (lineGid, pairs) => {
  const value = pairs.find((p) => p.name === LINE_PROPERTY)?.value;
  const parsed = parseLineProperty(value);
  return parsed && lineGid ? [{ lineGid, ...parsed }] : [];
};

/** Order lines carrying a test's property, from an order webhook (REST: `line_items[].properties`). */
export function testLinesFromWebhook(order) {
  return (order?.line_items ?? []).flatMap((item) => {
    const lineGid = item.admin_graphql_api_id ?? (item.id ? `gid://shopify/LineItem/${item.id}` : null);
    const pairs = Array.isArray(item.properties) ? item.properties.map((p) => ({ name: p?.name, value: p?.value })) : [];
    return tagged(lineGid, pairs);
  });
}

/** The same from orders JSONL (bulk query: line items with `customAttributes { key value }`). */
export function testLinesFromBulk(rows) {
  return rows.flatMap((row) => {
    if (!row?.__parentId || !String(row.id ?? "").startsWith("gid://shopify/LineItem/")) return [];
    const pairs = Array.isArray(row.customAttributes) ? row.customAttributes.map((p) => ({ name: p?.key, value: p?.value })) : [];
    return tagged(row.id, pairs);
  });
}

/**
 * Purchases to record: each tagged line joined with its stored order line (quantity now, revenue),
 * kept when its test is known, the line is the test's product and the order came while it ran.
 * `tests` maps test id → `{ productGid, startedAt, endedAt }`; `orderedAt` maps order GID → Date.
 */
export function purchasesFor(testLines, orderLines, tests, orderedAt) {
  const lines = new Map(orderLines.map((l) => [l.lineGid, l]));
  return testLines.flatMap(({ lineGid, testId, visitorId }) => {
    const line = lines.get(lineGid);
    const test = tests.get(testId);
    if (!line || !test || line.productGid !== test.productGid) return [];
    const at = orderedAt.get(line.orderGid);
    if (!at || at < test.startedAt || (test.endedAt && at > test.endedAt)) return [];
    return [{ testId, lineGid, orderGid: line.orderGid, visitorId, variant: variantOf(testId, visitorId), quantity: line.quantity, revenue: line.revenue, orderedAt: at }];
  });
}

/** Sums visitors' and purchases' grouped rows into `{ a, b }` counts for `testStats`. */
export function countsFrom(visitorGroups, purchaseGroups) {
  const counts = new Map();
  const side = (testId, variant) => {
    if (!counts.has(testId)) counts.set(testId, { a: { ...EMPTY }, b: { ...EMPTY } });
    return counts.get(testId)[variant === "b" ? "b" : "a"];
  };
  for (const g of visitorGroups) {
    const s = side(g.testId, g.variant);
    s.visitors += g.visitors;
    s.carts += g.carts;
  }
  for (const g of purchaseGroups) {
    if (!(g.units > 0)) continue;
    const s = side(g.testId, g.variant);
    s.buyers += 1;
    s.units += g.units;
    s.revenue += Number(g.revenue ?? 0);
  }
  return counts;
}

/**
 * A version as the list of tests shows it: the title, the description's first words, or the photos in
 * order (preview URLs from the test's start, up to 4).
 */
export function versionView(kind, state, previews = {}) {
  if (kind === "title") return { text: state?.title ?? "" };
  if (kind === "description") return { text: textPreview(state?.descriptionHtml) };
  return { photos: (state?.mediaIds ?? []).slice(0, 4).map((id) => previews[id] ?? null) };
}

export const END_REASONS = {
  b_better: "B is better",
  a_better: "A is better",
  time: "30 days are over",
  stopped: "Stopped",
  changed: "The product changed in Shopify",
  plan: "Your plan no longer includes A/B tests",
  product_gone: "The product was deleted",
  used_b: "B is in use",
};
