// The product list's "Last change" column (the owner's design). Pure, so node:test can load it.

const CHANGED = {
  title: "Title changed",
  description: "Description changed",
  seo: "SEO changed",
  images: "Photos reordered",
  photo: "Photo added",
  collection: "Collections changed",
  position: "Moved up in a collection",
};
const VERDICT = { improved: "Improved", no_change: "No change", worse: "Worse", not_enough_data: "Not enough data", measuring: "Measuring" };

/**
 * "Title changed · Improved" (judged by its rescue plan), "Photo added · Oct 12" (not in a plan), or
 * "—". `change`: `{ type, at, verdict }` (`verdict` null when the fix isn't in the product's plan).
 */
export function changeLabel(change) {
  if (!change) return "—";
  const what = CHANGED[change.type] ?? "Changed";
  if (change.verdict && change.verdict !== "cancelled") return `${what} · ${VERDICT[change.verdict] ?? change.verdict}`;
  const at = change.at ? new Date(change.at) : null;
  // The viewer's own calendar, like the other dates in the app.
  return at && !Number.isNaN(at.getTime()) ? `${what} · ${at.toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : what;
}
