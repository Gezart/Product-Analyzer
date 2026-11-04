// Shared pieces of the owner's design: page header, cards, buttons, pills. Class names are written out
// in full so Tailwind finds them.

import Link from "next/link";

/** Buttons and button-like links (the design: 8px corners, 600 weight). */
export const BTN = {
  primary:
    "inline-flex items-center justify-center gap-2 rounded-lg border-0 bg-ink px-3.5 py-[9px] text-sm font-semibold text-white no-underline hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:opacity-50",
  secondary:
    "inline-flex items-center justify-center gap-2 rounded-lg border border-line-strong bg-white px-3.5 py-[9px] text-sm font-semibold text-ink no-underline hover:bg-head hover:text-ink disabled:cursor-not-allowed disabled:opacity-50",
  small:
    "inline-flex items-center justify-center gap-1.5 rounded-lg border border-line-strong bg-white px-3 py-[7px] text-[13px] font-semibold text-ink no-underline whitespace-nowrap hover:bg-head hover:text-ink disabled:cursor-not-allowed disabled:opacity-50",
  /** A compact row action (the design's "Move to top": 5px 10px). */
  tiny:
    "inline-flex items-center justify-center gap-1.5 rounded-lg border border-line-strong bg-white px-2.5 py-[5px] text-[13px] font-semibold text-ink no-underline whitespace-nowrap hover:bg-head hover:text-ink disabled:cursor-not-allowed disabled:opacity-50",
  /** A full-width call to action in a card (the design's "Fix the page →": 10px 14px). */
  block:
    "flex w-full items-center justify-center gap-2 rounded-lg border-0 bg-ink px-3.5 py-2.5 text-center text-sm font-semibold text-white no-underline hover:bg-black hover:text-white",
  smallPrimary:
    "inline-flex items-center justify-center gap-1.5 rounded-lg border-0 bg-ink px-3 py-[7px] text-[13px] font-semibold text-white no-underline whitespace-nowrap hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:opacity-50",
};

/** A white card with the design's border and 12px corners. */
export const CARD = "rounded-xl border border-line bg-white";
/** Small uppercase label (e.g. "Weekly plan · Monday, Nov 2"). */
export const KICKER = "m-0 text-xs font-semibold uppercase tracking-[0.06em] text-accent";
/** A card's heading. */
export const H2 = "m-0 text-[15px] font-bold";
/** Table head row and cells. */
export const TH = "px-3 py-[9px] text-left font-semibold";
export const THEAD = "bg-head text-muted";
export const TROW = "border-t border-hair";

/** The page title with its subtitle and actions on the right. */
export function PageHeader({ title, subtitle, actions, back }) {
  return (
    <>
      {back && (
        <Link href={back.href} className="self-start text-[13px] font-semibold">
          ← {back.label}
        </Link>
      )}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="m-0 text-[22px] font-bold tracking-[-0.01em]">{title}</h1>
          {subtitle && <p className="mt-0.5 mb-0 text-[13px] text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </header>
    </>
  );
}

/** A section card; `heading` gives it a title row (with `aside` on the right). */
export function Card({ heading, aside, children, className = "", ...rest }) {
  return (
    <section className={`${CARD} ${className}`} {...rest}>
      {heading && (
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-[18px] pb-2.5">
          <h2 className={H2}>{heading}</h2>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

/** The design's status colors (background, text). */
export const PILL_TONES = {
  dead_stock: "bg-[#FEE2E2] text-[#B91C1C]",
  slow_mover: "bg-[#FEF3C7] text-[#92400E]",
  page_problem: "bg-[#FFEDD5] text-[#9A3412]",
  hidden_gem: "bg-[#E0F2FE] text-[#075985]",
  stockout_risk: "bg-[#EDE9FE] text-[#5B21B6]",
  new: "bg-[#F3F4F6] text-[#374151]",
  healthy: "bg-[#D1FAE5] text-[#065F46]",
  seasonal: "bg-[#CCFBF1] text-[#115E59]",
  rising: "bg-accent-soft text-accent-hover",
  neutral: "bg-[#F3F4F6] text-[#374151]",
  high: "bg-[#FEE2E2] text-[#B91C1C]",
  medium: "bg-[#FEF3C7] text-[#92400E]",
  low: "bg-[#F3F4F6] text-[#374151]",
  good: "bg-[#D1FAE5] text-[#065F46]",
  warn: "bg-[#FEF3C7] text-[#92400E]",
  bad: "bg-[#FEE2E2] text-[#B91C1C]",
  info: "bg-accent-soft text-accent",
};

/** A rounded status pill. `tone`: a status or one of the tones above. */
export function Pill({ tone = "neutral", children, className = "" }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${PILL_TONES[tone] ?? PILL_TONES.neutral} ${className}`}>{children}</span>;
}
