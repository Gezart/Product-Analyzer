// The Collection Optimizer page (the owner's design): each collection's state in the list, each row's
// move, and moving a row by dragging. Pure (no imports) so node:test can load it.

const day = (iso, timeZone) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone });

/**
 * A collection's line in the list: `{ text, tone }` (tone: accent, good, warn, bad, muted). `c` is a
 * listed collection with its latest saved order (`latest`, or null).
 */
export function collectionState(c, { timeZone } = {}) {
  if (c.tooLarge) return { text: "Too many products to reorder here", tone: "warn" };
  const s = c.latest;
  if (!s) return { text: "Not optimized yet", tone: "muted" };
  if (s.status === "applied") return { text: `Applied ${day(s.appliedAt ?? s.createdAt, timeZone)} · ${s.moved} moved`, tone: "good" };
  if (s.status === "undone") return { text: `Undone ${day(s.undoneAt ?? s.createdAt, timeZone)}`, tone: "muted" };
  if (s.status === "failed") return { text: "Last save failed", tone: "bad" };
  return { text: s.status === "undoing" ? "Undoing…" : "Saving…", tone: "accent" };
}

/** A row's move from its place now to its new one (0-based): "↑ 26" (up, good), "↓ 3" (down, warn) or "—". */
export function moveLabel(from, to) {
  const d = from - to;
  if (d === 0) return { text: "—", tone: "muted" };
  return d > 0 ? { text: `↑ ${d}`, tone: "good" } : { text: `↓ ${-d}`, tone: "warn" };
}

/** The order after dragging the row at `from` onto the place of the row at `to`. */
export function dragMove(order, from, to) {
  if (from === to || from < 0 || to < 0 || from >= order.length || to >= order.length) return order;
  const next = [...order];
  const [id] = next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}
