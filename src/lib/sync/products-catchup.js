// Hourly products catch-up: which window to re-read and which products to sync again. Webhooks can be
// missed (the app URL changed, Shopify dropped deliveries); this keeps new and edited products from
// waiting for the nightly catalog refresh.

/** Re-read this much before the last run (Shopify's search index can lag a little). */
export const OVERLAP_MS = 10 * 60_000;
/** Never further back than this: the nightly catalog refresh covers anything older. */
export const MAX_WINDOW_MS = 25 * 3_600_000;

/** Start of the window to re-read. */
export function catchupSince(lastSyncedAt, now) {
  const floor = now.getTime() - MAX_WINDOW_MS;
  const from = lastSyncedAt ? new Date(lastSyncedAt).getTime() - OVERLAP_MS : floor;
  return new Date(Math.max(from, floor));
}

/** Shopify search syntax for products updated since `since` (whole seconds, UTC). */
export function updatedSinceQuery(since) {
  return `updated_at:>='${since.toISOString().replace(/\.\d{3}Z$/, "Z")}'`;
}

/** GIDs of products changed in Shopify after our last copy, or not stored here at all. */
export function staleProducts(nodes, known) {
  return nodes
    .filter((n) => {
      const at = known.get(n.id);
      return !at || new Date(at).getTime() < new Date(n.updatedAt).getTime();
    })
    .map((n) => n.id);
}

/** Where the next run starts: this run's start when the window was read to the end, else the last product read. */
export function nextMark(nodes, complete, startedAt) {
  if (complete || !nodes.length) return startedAt;
  return new Date(new Date(nodes.at(-1).updatedAt).getTime() + OVERLAP_MS);
}
