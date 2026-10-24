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

// ---- Choosing what to write (pure, so every money decision is unit-tested) ----

export type LivePrice = { id: string; price: number; compareAtPrice: number | null; cost: number | null; inventory: number };
/** What the app last wrote per variant (variant id → price and compare-at). */
export type Applied = Record<string, { price: number; compareAt: number | null }>;
export type PriceWrite = { id: string; price: number; compareAtPrice: number | null; floor: number | null; reason: "markdown" | "restore" | "guard_revert" };

/** Floor now: the stricter of the floor at approval and the floor from the live cost. */
export function currentFloor(v: VariantPlan, liveCost: number | null, marginFloorPct: number): number {
  const live = floorPrice(liveCost, marginFloorPct);
  return Math.max(v.floor, live ?? v.floor);
}

/**
 * Writes needed to move a plan to `step`. A variant is skipped when it no longer exists, when the
 * floor has risen to its original price (it can't be discounted any more), or when it already shows
 * the target. If a live price is neither what the app last wrote nor the target, someone changed it
 * in Shopify: the plan must pause (`changedByMerchant`). The target never exceeds the original price,
 * never goes below the current floor, and never exceeds the stricter max discount.
 */
export function stepWrites(
  variants: VariantPlan[],
  live: LivePrice[],
  applied: Applied,
  step: number,
  settings: { marginFloorPct: number; maxDiscountPct: number; approvedMaxDiscountPct: number },
) {
  const byId = new Map(live.map((l) => [l.id, l]));
  const writes: PriceWrite[] = [];
  const alreadyApplied: Applied = {};
  const changedByMerchant: string[] = [];
  const cantDiscount: string[] = [];
  const maxDiscount = Math.min(settings.maxDiscountPct, settings.approvedMaxDiscountPct);
  for (const v of variants) {
    const lv = byId.get(v.id);
    if (!lv) continue;
    const floor = currentFloor(v, lv.cost, settings.marginFloorPct);
    const lastWritten = applied[v.id]?.price ?? v.originalPrice;
    if (cents(floor) >= cents(v.originalPrice)) {
      cantDiscount.push(v.id);
      continue;
    }
    const target = discountedPrice(v.originalPrice, LADDER.steps[step], floor, maxDiscount);
    if (cents(lv.price) === cents(target)) {
      alreadyApplied[v.id] = { price: target, compareAt: v.compareAt };
      continue;
    }
    if (cents(lv.price) !== cents(lastWritten)) {
      changedByMerchant.push(v.id);
      continue;
    }
    writes.push({ id: v.id, price: target, compareAtPrice: v.compareAt, floor, reason: "markdown" });
  }
  return { writes, alreadyApplied, changedByMerchant, cantDiscount };
}

/** Writes that put back original prices — only where the live price is still the one the app wrote. */
export function restoreWrites(variants: VariantPlan[], live: LivePrice[], applied: Applied): PriceWrite[] {
  const byId = new Map(live.map((l) => [l.id, l]));
  return variants.flatMap((v) => {
    const lv = byId.get(v.id);
    const ours = applied[v.id];
    if (!lv || !ours || cents(lv.price) !== cents(ours.price) || cents(lv.price) === cents(v.originalPrice)) return [];
    return [{ id: v.id, price: v.originalPrice, compareAtPrice: v.originalCompareAt, floor: null, reason: "restore" as const }];
  });
}

/**
 * Price guard. A live price below the current floor is a problem. If it's the app's own price (the
 * plan is active), it is raised to the floor — never above the original; when the floor reached the
 * original, the original comes back. Prices set by hand, and any price on a paused plan, are only
 * reported (`alerts`), never changed.
 */
export function guardWrites(variants: VariantPlan[], live: LivePrice[], applied: Applied, opts: { marginFloorPct: number; paused: boolean }) {
  const byId = new Map(live.map((l) => [l.id, l]));
  const writes: PriceWrite[] = [];
  const alerts: string[] = [];
  for (const v of variants) {
    const lv = byId.get(v.id);
    if (!lv) continue;
    const floor = currentFloor(v, lv.cost, opts.marginFloorPct);
    if (cents(lv.price) >= cents(floor)) continue;
    const ours = applied[v.id] && cents(lv.price) === cents(applied[v.id].price);
    if (!ours || opts.paused) {
      alerts.push(v.id);
      continue;
    }
    if (cents(floor) >= cents(v.originalPrice)) {
      writes.push({ id: v.id, price: v.originalPrice, compareAtPrice: v.originalCompareAt, floor: null, reason: "restore" });
    } else {
      writes.push({ id: v.id, price: floor, compareAtPrice: v.compareAt, floor, reason: "guard_revert" });
    }
    alerts.push(v.id);
  }
  return { writes, alerts };
}

/** Units in stock now across the plan's variants (from live data). */
export function liveStock(live: LivePrice[]) {
  return live.reduce((s, v) => s + Math.max(0, v.inventory), 0);
}
