// Page builder (docs/TASKS.md, Phase 3b): which blocks show on product pages, in which order, with
// their settings and the products they're used for. Pure (relative imports only) so node:test can load it.

export const BLOCK_TYPES = ["low_stock", "trust_badges", "size_chart", "bought_together"];

export const BLOCK_LABELS = {
  low_stock: "Only X left",
  trust_badges: "Trust badges",
  size_chart: "Size chart",
  bought_together: "Often bought together",
};

export const BADGE_ICONS = ["shipping", "returns", "secure", "guarantee", "support"];

export const LIMITS = {
  threshold: { min: 1, max: 50 },
  boughtTogether: { min: 1, max: 4 },
  badges: 4,
  badgeText: 40,
  lowStockText: 80,
  title: 60,
  note: 200,
  chartRows: { min: 2, max: 15 },
  chartColumns: { min: 2, max: 8 },
  cell: 24,
  useForIds: 250,
};

const COUNT = "{count}";

const ALL = { mode: "all", collectionIds: [], productIds: [] };

export const DEFAULT_BLOCKS = {
  low_stock: { threshold: 5, text: `Only ${COUNT} left in stock` },
  trust_badges: {
    items: [
      { icon: "shipping", text: "Free shipping" },
      { icon: "returns", text: "30-day returns" },
      { icon: "secure", text: "Secure checkout" },
    ],
  },
  size_chart: {
    label: "Size chart",
    rows: [
      ["Size", "Chest (cm)", "Waist (cm)"],
      ["S", "88–94", "74–80"],
      ["M", "95–101", "81–87"],
      ["L", "102–108", "88–94"],
    ],
    note: "",
  },
  bought_together: { title: "Often bought together", max: 3 },
};

/** Every block off, in the default order: nothing shows on the storefront until the merchant turns one on. */
export const DEFAULT_PAGE_BUILDER = {
  blocks: BLOCK_TYPES.map((type) => ({ type, enabled: false, useFor: ALL, settings: DEFAULT_BLOCKS[type] })),
};

const GID = { collection: /^gid:\/\/shopify\/Collection\/\d+$/, product: /^gid:\/\/shopify\/Product\/\d+$/ };

const isText = (value, max, { required = true } = {}) =>
  typeof value === "string" && value.length <= max && (!required || value.trim().length > 0);

const isInt = (value, { min, max }) => Number.isInteger(value) && value >= min && value <= max;

function gidList(value, pattern) {
  if (!Array.isArray(value) || value.length > LIMITS.useForIds) return null;
  if (!value.every((id) => typeof id === "string" && pattern.test(id))) return null;
  return [...new Set(value)];
}

/** `{ value }` or `{ error }` for a block's "Use for". */
function checkUseFor(useFor) {
  if (!useFor || typeof useFor !== "object") return { error: "Choose where the block is used." };
  if (useFor.mode === "all") return { value: ALL };

  if (useFor.mode === "collections") {
    const ids = gidList(useFor.collectionIds, GID.collection);
    if (!ids) return { error: "The collections aren't valid." };
    if (!ids.length) return { error: "Pick at least one collection." };
    return { value: { mode: "collections", collectionIds: ids, productIds: [] } };
  }

  if (useFor.mode === "products") {
    const ids = gidList(useFor.productIds, GID.product);
    if (!ids) return { error: "The products aren't valid." };
    if (!ids.length) return { error: "Pick at least one product." };
    return { value: { mode: "products", collectionIds: [], productIds: ids } };
  }

  return { error: "Choose where the block is used." };
}

function checkLowStock(s) {
  if (!isInt(s.threshold, LIMITS.threshold)) return { error: `Show it at ${LIMITS.threshold.min} to ${LIMITS.threshold.max} left.` };
  if (!isText(s.text, LIMITS.lowStockText) || !s.text.includes(COUNT)) return { error: `The text needs ${COUNT} (up to ${LIMITS.lowStockText} characters).` };
  return { value: { threshold: s.threshold, text: s.text.trim() } };
}

function checkTrustBadges(s) {
  if (!Array.isArray(s.items) || s.items.length < 1 || s.items.length > LIMITS.badges) return { error: `Add 1 to ${LIMITS.badges} badges.` };
  const items = [];
  for (const item of s.items) {
    if (!item || !BADGE_ICONS.includes(item.icon)) return { error: "Pick an icon for every badge." };
    if (!isText(item.text, LIMITS.badgeText)) return { error: `Every badge needs a text (up to ${LIMITS.badgeText} characters).` };
    items.push({ icon: item.icon, text: item.text.trim() });
  }
  return { value: { items } };
}

function checkSizeChart(s) {
  if (!isText(s.label, LIMITS.title)) return { error: `The size chart needs a label (up to ${LIMITS.title} characters).` };
  if (!isText(s.note ?? "", LIMITS.note, { required: false })) return { error: `The note can have up to ${LIMITS.note} characters.` };
  const rows = s.rows;
  const { chartRows, chartColumns } = LIMITS;
  if (!Array.isArray(rows) || rows.length < chartRows.min || rows.length > chartRows.max) return { error: `The chart needs ${chartRows.min} to ${chartRows.max} rows.` };
  const width = Array.isArray(rows[0]) ? rows[0].length : 0;
  if (width < chartColumns.min || width > chartColumns.max) return { error: `The chart needs ${chartColumns.min} to ${chartColumns.max} columns.` };
  const cellsOk = rows.every((row) => Array.isArray(row) && row.length === width && row.every((cell) => isText(cell, LIMITS.cell, { required: false })));
  if (!cellsOk) return { error: `Every row needs ${width} cells of up to ${LIMITS.cell} characters.` };
  if (!rows[0].every((cell) => cell.trim())) return { error: "Every column needs a heading." };
  return { value: { label: s.label.trim(), rows: rows.map((row) => row.map((cell) => cell.trim())), note: (s.note ?? "").trim() } };
}

function checkBoughtTogether(s) {
  if (!isText(s.title, LIMITS.title)) return { error: `The title is needed (up to ${LIMITS.title} characters).` };
  if (!isInt(s.max, LIMITS.boughtTogether)) return { error: `Show ${LIMITS.boughtTogether.min} to ${LIMITS.boughtTogether.max} products.` };
  return { value: { title: s.title.trim(), max: s.max } };
}

const SETTINGS_CHECKS = {
  low_stock: checkLowStock,
  trust_badges: checkTrustBadges,
  size_chart: checkSizeChart,
  bought_together: checkBoughtTogether,
};

/**
 * Checks the page builder sent by the app: every block type exactly once (their order is the order on
 * the page), each with valid settings and "Use for". `{ ok: true, value }` or `{ ok: false, errors }`
 * with `{ field, message }` per problem (`field` is the block type, or "blocks").
 */
export function validatePageBuilder(body) {
  const blocks = body?.blocks;
  const types = Array.isArray(blocks) ? blocks.map((b) => b?.type) : [];
  const complete = types.length === BLOCK_TYPES.length && BLOCK_TYPES.every((t) => types.includes(t));
  if (!complete) return { ok: false, errors: [{ field: "blocks", message: "The blocks aren't valid." }] };

  const errors = [];
  const value = { blocks: [] };
  for (const block of blocks) {
    const settings = block.settings && typeof block.settings === "object" ? SETTINGS_CHECKS[block.type](block.settings) : { error: "Settings are missing." };
    const useFor = checkUseFor(block.useFor);
    if (typeof block.enabled !== "boolean") errors.push({ field: block.type, message: "On or off is missing." });
    if (settings.error) errors.push({ field: block.type, message: settings.error });
    if (useFor.error) errors.push({ field: block.type, message: useFor.error });
    value.blocks.push({ type: block.type, enabled: block.enabled === true, useFor: useFor.value, settings: settings.value });
  }
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

/** The stored page builder, read back safely: anything malformed falls back to the defaults (all off). */
export function pageBuilderOf(raw) {
  const result = validatePageBuilder(raw);
  return result.ok ? result.value : DEFAULT_PAGE_BUILDER;
}

const numericId = (gid) => Number(gid.split("/").pop());

/**
 * What the theme app extension reads (the shop's `$app.page_builder` metafield): the blocks that are
 * on, in order, with their settings and numeric ids for "Use for" (Liquid compares them with
 * `product.id` and `collection.id`). `included` false (the plan doesn't have the page builder) shows
 * nothing.
 */
export function storefrontConfig(pageBuilder, { included }) {
  const blocks = included ? pageBuilder.blocks.filter((b) => b.enabled) : [];
  return {
    v: 1,
    blocks: blocks.map((b) => {
      const ids = b.useFor.mode === "products" ? b.useFor.productIds : b.useFor.collectionIds;
      return { type: b.type, for: { mode: b.useFor.mode, ids: ids.map(numericId) }, ...b.settings };
    }),
  };
}

/** Whether a block type is on (e.g. to know if "often bought together" needs refreshing). */
export const blockEnabled = (pageBuilder, type) => pageBuilder.blocks.some((b) => b.type === type && b.enabled);

/** "Only {count} left" with the count filled in (the preview; the storefront does the same). */
export const lowStockText = (text, count) => text.split(COUNT).join(String(count));

export const BOUGHT_TOGETHER = {
  /** Products kept per product (the block shows up to 4). */
  max: 4,
  /** A pair counts once it was in this many orders together. */
  minOrders: 2,
};

/**
 * Products often bought together, from order lines (`{ orderGid, productGid }`): for every product,
 * the others in the same orders, most shared orders first (ties by id), at least `minOrders` shared
 * orders, up to `max`. Only `eligible` products (active, still in the store) are suggested.
 * Returns a Map productGid → [productGid].
 */
export function boughtTogether(lines, eligible, { max = BOUGHT_TOGETHER.max, minOrders = BOUGHT_TOGETHER.minOrders } = {}) {
  const orders = new Map();
  for (const line of lines) {
    if (!orders.has(line.orderGid)) orders.set(line.orderGid, new Set());
    orders.get(line.orderGid).add(line.productGid);
  }

  const pairs = new Map();
  const count = (a, b) => {
    if (!pairs.has(a)) pairs.set(a, new Map());
    const partners = pairs.get(a);
    partners.set(b, (partners.get(b) ?? 0) + 1);
  };
  for (const products of orders.values()) {
    const list = [...products];
    for (const a of list) for (const b of list) if (a !== b) count(a, b);
  }

  const result = new Map();
  for (const [product, partners] of pairs) {
    const top = [...partners]
      .filter(([partner, shared]) => shared >= minOrders && eligible.has(partner))
      .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
      .slice(0, max)
      .map(([partner]) => partner);
    if (top.length) result.set(product, top);
  }
  return result;
}

const sameList = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * What to change in Shopify: `set` products whose list is new or different, `clear` products that had
 * a list and now have none. `current` is Map productGid → [gid] (what was written last time).
 */
export function boughtTogetherChanges(current, next) {
  const set = [];
  for (const [product, list] of next) {
    if (!sameList(current.get(product) ?? [], list)) set.push({ product, list });
  }
  const clear = [...current.keys()].filter((product) => (current.get(product) ?? []).length && !next.has(product));
  return { set, clear };
}
