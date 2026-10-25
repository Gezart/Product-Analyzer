// Colors per status for the custom (Tailwind) visuals; badges keep Polaris tones from STATUS_INFO.
// Class names are written out in full so Tailwind finds them.
export const STATUS_STYLE = {
  dead_stock: { bar: "bg-red-500", soft: "bg-red-50", text: "text-red-700" },
  slow_mover: { bar: "bg-amber-400", soft: "bg-amber-50", text: "text-amber-700" },
  page_problem: { bar: "bg-orange-500", soft: "bg-orange-50", text: "text-orange-700" },
  hidden_gem: { bar: "bg-sky-500", soft: "bg-sky-50", text: "text-sky-700" },
  stockout_risk: { bar: "bg-violet-500", soft: "bg-violet-50", text: "text-violet-700" },
  healthy: { bar: "bg-emerald-500", soft: "bg-emerald-50", text: "text-emerald-700" },
};

const NEUTRAL = { bar: "bg-zinc-400", soft: "bg-zinc-100", text: "text-zinc-600" };

export const statusStyle = (status) => STATUS_STYLE[status] ?? NEUTRAL;

/** Card surface without a border color, for cards that pick their own. */
export const CARD_SURFACE = "rounded-2xl border bg-white shadow-card";

/** Card surface shared by the redesigned screens. */
export const CARD = `${CARD_SURFACE} border-zinc-200`;

/** Small uppercase label above a number. */
export const EYEBROW = "text-xs font-semibold uppercase tracking-wider text-zinc-500";

/** Dark primary action, matching Polaris' primary button. */
export const PRIMARY_LINK =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.15),0_1px_2px_rgb(0_0_0/0.25)] transition hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500";
