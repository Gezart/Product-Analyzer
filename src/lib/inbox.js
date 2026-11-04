// The inbox (the owner's design): the weekly plan's rows, last week's lines, and each notification's
// icon, tone, kind and time. Pure (no imports) so node:test can load it.

const strip = (text, prefix) => (text?.startsWith(prefix) ? text.slice(prefix.length) : (text ?? ""));
const sentence = (text) => {
  const t = text.trim().replace(/\.$/, "");
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
};

/**
 * One move of the weekly plan as a row: `{ title, why, cta, href }`. `a` is a stored plan action
 * (`{ productId, title, status, moneyAtStake, kind, text, href }`), `money` formats the store's currency.
 */
export function planRow(a, money) {
  const stake = a.moneyAtStake > 0 ? `${money.format(a.moneyAtStake)} at stake` : null;
  const why = (...parts) => parts.filter(Boolean).join(" · ");
  switch (a.kind) {
    case "reorder":
      return { title: `Reorder ${a.title}`, why: sentence(strip(a.text, "Reorder: ")), cta: "See stock", href: a.href };
    case "markdown":
      return { title: `Start the markdown for ${a.title}`, why: why(stake, sentence(strip(a.text, "Start the markdown. "))), cta: "Start markdown", href: a.href };
    case "visibility":
      return { title: `Give ${a.title} a better place in its collections`, why: why(stake, "It sells well to the few who see it"), cta: "Open Collections", href: a.href };
    case "fix_page":
      return { title: `Fix what holds ${a.title} back`, why: why(stake, sentence(strip(a.text, "What holds it back: "))), cta: "See why", href: a.href };
    case "diagnose":
      return { title: `Find out why ${a.title} isn't selling`, why: why(stake, "Run its diagnosis"), cta: "Diagnose", href: a.href };
    default:
      return { title: a.title, why: why(stake, sentence(a.text ?? "")), cta: "Open", href: a.href };
  }
}

const VERDICT_LABELS = { improved: "Improved", worse: "Worse", no_change: "No change", not_enough_data: "Not enough data" };
const ENDED = { stock_cleared: "the stock cleared", ladder_finished: "all steps done", cancelled: "stopped" };

/**
 * Last week's results as lines: `[{ text, strong?, productId?, title? }]`. Improved fixes come first as
 * one line with what they brought in; then the other verdicts and the markdowns, each about one product.
 */
export function lastWeekLines(recap, money) {
  if (!recap) return [];
  const lines = [];
  const improved = (recap.verdicts ?? []).filter((v) => v.verdict === "improved");
  if (improved.length) {
    const n = improved.length;
    lines.push({
      before: `${n} fix${n === 1 ? "" : "es"} came back `,
      strong: "Improved",
      after: recap.extraSales > 0 ? `: about ${money.format(recap.extraSales)} in extra sales.` : ".",
      products: improved.map((v) => ({ productId: v.productId, title: v.title })),
    });
  }
  for (const v of (recap.verdicts ?? []).filter((x) => x.verdict !== "improved")) {
    const next = v.verdict === "worse" ? " Undo the fixes on its page." : v.verdict === "no_change" ? " See the next step on its page." : "";
    lines.push({ before: "", product: { productId: v.productId, title: v.title }, after: `: ${VERDICT_LABELS[v.verdict] ?? v.verdict}.${next}` });
  }
  for (const m of recap.markdownsStarted ?? []) lines.push({ before: "Markdown started for ", product: { productId: m.productId, title: m.title }, after: "." });
  for (const m of recap.markdownsEnded ?? []) {
    lines.push({ before: "Markdown ended for ", product: { productId: m.productId, title: m.title }, after: m.endReason ? ` (${ENDED[m.endReason] ?? m.endReason}).` : "." });
  }
  return lines;
}

/** Each notification type's icon, tone (good, info, warn, bad) and kind label; unknown types get a bell. */
export const KINDS = {
  analysis_ready: { icon: "chart", tone: "info", label: "Analysis" },
  new_attention: { icon: "alert", tone: "warn", label: "Analysis" },
  rescue_verdict: { icon: "check", tone: "good", label: "Rescue plan" },
  markdown_floor_reached: { icon: "tag", tone: "warn", label: "Markdown" },
  markdown_paused: { icon: "pause", tone: "warn", label: "Markdown" },
  markdown_unsold: { icon: "tag", tone: "warn", label: "Markdown" },
  markdown_restore_failed: { icon: "alert", tone: "bad", label: "Markdown" },
  price_guard: { icon: "alert", tone: "bad", label: "Price guard" },
  monthly_report: { icon: "chart", tone: "good", label: "Monthly report" },
  season_soon: { icon: "calendar", tone: "info", label: "Season" },
  season_ended: { icon: "calendar", tone: "warn", label: "Season" },
  weekly_plan: { icon: "list", tone: "info", label: "Weekly plan" },
};
const DEFAULT_KIND = { icon: "bell", tone: "info", label: "Update" };

/** A notification's look: a rescue verdict's tone follows the verdict (worse is bad, no change a warning). */
export function kindOf(type, verdict) {
  const kind = KINDS[type] ?? DEFAULT_KIND;
  if (type === "rescue_verdict" && verdict) {
    const tone = verdict === "improved" ? "good" : verdict === "worse" ? "bad" : verdict === "no_change" ? "warn" : "info";
    return { ...kind, tone };
  }
  return kind;
}

/** "Just now", "5 min ago", "2 h ago" today; then "Yesterday"; then "Oct 20" (with the year if not this year). */
export function whenLabel(createdAt, now = new Date(), timeZone) {
  const at = new Date(createdAt);
  const minutes = Math.floor((now - at) / 60_000);
  const dayKey = (d) => d.toLocaleDateString("en-CA", { timeZone });
  if (dayKey(at) === dayKey(now)) {
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes} min ago`;
    return `${Math.floor(minutes / 60)} h ago`;
  }
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (dayKey(at) === dayKey(yesterday)) return "Yesterday";
  const sameYear = at.toLocaleDateString("en-US", { year: "numeric", timeZone }) === now.toLocaleDateString("en-US", { year: "numeric", timeZone });
  return at.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), timeZone });
}
