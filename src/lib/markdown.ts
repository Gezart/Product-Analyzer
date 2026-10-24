// Markdown ladder — docs/PLAN.md → "Markdown ladder" and module 7. Pure (no imports) so node:test can
// load it. The money rule: a price NEVER goes below cost × (1 + minimum margin). A variant without a
// known cost has no known floor, so it is never discounted.

export const LADDER = { steps: [0.1, 0.2, 0.3], stepDays: 14, sellThroughStop: 0.5 };

export type MarkdownSettings = { marginFloorPct: number; maxDiscountPct: number };

export type VariantPrice = {
  id: string;
  title: string;
  price: number;
  compareAtPrice: number | null;
  cost: number | null;
};

export type VariantPlan = {
  id: string;
  title: string;
  /** Price and compare-at before the plan, restored at the end. */
  originalPrice: number;
  originalCompareAt: number | null;
  /** cost × (1 + margin), rounded up to the cent. */
  floor: number;
  /** Price at each ladder step (never below `floor`, never more than the max discount off). */
  stepPrices: number[];
  /** Compare-at shown while discounted: the original compare-at if higher, else the original price. */
  compareAt: number;
};

export type LadderProposal = {
  variants: VariantPlan[];
  /** Variants left at full price, and why. */
  skipped: { id: string; title: string; reason: string }[];
};

const cents = (n: number) => Math.round(n * 100);
const fromCents = (c: number) => c / 100;

/** Lowest allowed price for a variant, rounded UP to the cent; null when the cost is unknown. */
export function floorPrice(cost: number | null, marginFloorPct: number): number | null {
  if (cost == null || !Number.isFinite(cost) || cost <= 0) return null;
  return fromCents(Math.ceil(cost * (1 + marginFloorPct / 100) * 100 - 1e-6));
}

/**
 * Price after `discount` (0–1): rounded DOWN to the cent for the step, but never more off than the
 * max discount (that bound is rounded UP) and never under the floor.
 */
export function discountedPrice(price: number, discount: number, floor: number, maxDiscountPct: number): number {
  const p = cents(price);
  const step = Math.floor(p * (1 - discount) + 1e-6);
  const maxOff = Math.ceil(p * (1 - maxDiscountPct / 100) - 1e-6);
  return fromCents(Math.min(p, Math.max(step, maxOff, cents(floor))));
}

/** The ladder for a product's variants, with each step's price per variant. */
export function proposeLadder(variants: VariantPrice[], settings: MarkdownSettings): LadderProposal {
  const out: LadderProposal = { variants: [], skipped: [] };
  for (const v of variants) {
    const floor = floorPrice(v.cost, settings.marginFloorPct);
    if (floor == null) {
      out.skipped.push({ id: v.id, title: v.title, reason: "No unit cost in Shopify, so the lowest safe price is unknown." });
      continue;
    }
    if (cents(v.price) <= cents(floor)) {
      out.skipped.push({ id: v.id, title: v.title, reason: "Already at or below the lowest price your margin allows." });
      continue;
    }
    const stepPrices = LADDER.steps.map((d) => discountedPrice(v.price, d, floor, settings.maxDiscountPct));
    out.variants.push({
      id: v.id,
      title: v.title,
      originalPrice: v.price,
      originalCompareAt: v.compareAtPrice,
      floor,
      stepPrices,
      compareAt: Math.max(v.compareAtPrice ?? 0, v.price),
    });
  }
  return out;
}

/** Index of the step due `daysSinceStart` days after the plan started (0-based); past the last → null. */
export function dueStep(daysSinceStart: number): number | null {
  const step = Math.floor(daysSinceStart / LADDER.stepDays);
  return step < LADDER.steps.length ? step : null;
}

/** Stop when half of the stock at the start has sold. */
export function stockCleared(startStock: number, stockNow: number): boolean {
  if (startStock <= 0) return true;
  return (startStock - Math.max(0, stockNow)) / startStock >= LADDER.sellThroughStop;
}

/** Last check before any price write: true only for a finite price at or above the floor. */
export function safeToWrite(price: number, floor: number | null): boolean {
  return floor != null && Number.isFinite(price) && cents(price) >= cents(floor);
}
