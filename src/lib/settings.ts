// Merchant rules — docs/PLAN.md module 10. Validation is pure (relative import only) so node:test can load it.
import { DEFAULT_THRESHOLDS, type Thresholds } from "./scoring.ts";

export type SettingsInput = {
  thresholds: Thresholds;
  marginFloorPct: number;
  maxDiscountPct: number;
  excludedCollectionIds: string[];
  excludedProductIds: string[];
  /** When a markdown ends: restore the original price, or hold the last discount. */
  markdownEndAction: "restore" | "hold";
};

/** A field error the form can turn into a message with its own label and units. */
export type FieldError = { field: string; min?: number; max?: number; integer?: boolean };

export const DEFAULT_SETTINGS: SettingsInput = {
  thresholds: DEFAULT_THRESHOLDS,
  marginFloorPct: 10,
  maxDiscountPct: 40,
  excludedCollectionIds: [],
  excludedProductIds: [],
  markdownEndAction: "restore",
};

type Rule = { min: number; max: number; integer?: boolean };

const THRESHOLD_RULES: Record<keyof Thresholds, Rule> = {
  pageProblemViewsTop: { min: 0.05, max: 0.95 },
  pageProblemConversionRatio: { min: 0.05, max: 1 },
  hiddenGemViewsBottom: { min: 0.05, max: 0.95 },
  slowSellThrough: { min: 0.01, max: 1 },
  deadDays: { min: 14, max: 365, integer: true },
  stockoutCoverDays: { min: 1, max: 120, integer: true },
  minViews: { min: 1, max: 10_000, integer: true },
};

const GID = { collection: /^gid:\/\/shopify\/Collection\/\d+$/, product: /^gid:\/\/shopify\/Product\/\d+$/ };
const MAX_EXCLUDED = 250;

function gidList(value: unknown, pattern: RegExp): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_EXCLUDED) return null;
  if (!value.every((id) => typeof id === "string" && pattern.test(id))) return null;
  return [...new Set(value as string[])];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function check(value: unknown, rule: Rule): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= rule.min &&
    value <= rule.max &&
    (!rule.integer || Number.isInteger(value))
  );
}

/** Strict validation for the settings form: returns the clean settings or a list of field errors. */
export function validateSettings(raw: unknown): { ok: true; value: SettingsInput } | { ok: false; errors: FieldError[] } {
  const errors: FieldError[] = [];
  const input = (raw ?? {}) as Record<string, unknown>;
  const rawThresholds = (input.thresholds ?? {}) as Record<string, unknown>;

  const thresholds = { ...DEFAULT_THRESHOLDS };
  for (const key of Object.keys(THRESHOLD_RULES) as (keyof Thresholds)[]) {
    const rule = THRESHOLD_RULES[key];
    const v = rawThresholds[key];
    if (check(v, rule)) thresholds[key] = v;
    else errors.push({ field: `thresholds.${key}`, ...rule });
  }

  const marginRule = { min: 0, max: 100 };
  const marginFloorPct = input.marginFloorPct;
  if (!check(marginFloorPct, marginRule)) errors.push({ field: "marginFloorPct", ...marginRule });

  const discountRule = { min: 1, max: 90 };
  const maxDiscountPct = input.maxDiscountPct;
  if (!check(maxDiscountPct, discountRule)) errors.push({ field: "maxDiscountPct", ...discountRule });

  const excludedCollectionIds = gidList(input.excludedCollectionIds, GID.collection);
  if (!excludedCollectionIds) errors.push({ field: "excludedCollectionIds", max: MAX_EXCLUDED });
  const excludedProductIds = gidList(input.excludedProductIds ?? [], GID.product);
  if (!excludedProductIds) errors.push({ field: "excludedProductIds", max: MAX_EXCLUDED });

  const endAction = input.markdownEndAction ?? "restore";
  if (endAction !== "restore" && endAction !== "hold") errors.push({ field: "markdownEndAction" });

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      thresholds,
      // Stored as Decimal(5,2).
      marginFloorPct: round2(marginFloorPct as number),
      maxDiscountPct: round2(maxDiscountPct as number),
      excludedCollectionIds: excludedCollectionIds!,
      excludedProductIds: excludedProductIds!,
      markdownEndAction: endAction as "restore" | "hold",
    },
  };
}
