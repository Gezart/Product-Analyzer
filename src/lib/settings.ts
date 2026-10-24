// Merchant rules — docs/PLAN.md module 10. Validation is pure (relative import only) so node:test can load it.
import { DEFAULT_THRESHOLDS, type Thresholds } from "./scoring.ts";

export type SettingsInput = {
  thresholds: Thresholds;
  marginFloorPct: number;
  maxDiscountPct: number;
  excludedCollectionIds: string[];
};

export const DEFAULT_SETTINGS: SettingsInput = {
  thresholds: DEFAULT_THRESHOLDS,
  marginFloorPct: 10,
  maxDiscountPct: 40,
  excludedCollectionIds: [],
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

const COLLECTION_GID = /^gid:\/\/shopify\/Collection\/\d+$/;

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
export function validateSettings(raw: unknown): { ok: true; value: SettingsInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const input = (raw ?? {}) as Record<string, unknown>;
  const rawThresholds = (input.thresholds ?? {}) as Record<string, unknown>;

  const thresholds = { ...DEFAULT_THRESHOLDS };
  for (const key of Object.keys(THRESHOLD_RULES) as (keyof Thresholds)[]) {
    const rule = THRESHOLD_RULES[key];
    const v = rawThresholds[key];
    if (check(v, rule)) thresholds[key] = v;
    else errors.push(`thresholds.${key} must be ${rule.integer ? "a whole number" : "a number"} from ${rule.min} to ${rule.max}`);
  }

  const marginFloorPct = input.marginFloorPct;
  if (!check(marginFloorPct, { min: 0, max: 100 })) errors.push("marginFloorPct must be from 0 to 100");

  const maxDiscountPct = input.maxDiscountPct;
  if (!check(maxDiscountPct, { min: 1, max: 90 })) errors.push("maxDiscountPct must be from 1 to 90");

  const ids = input.excludedCollectionIds;
  if (!Array.isArray(ids) || ids.length > 250 || !ids.every((id) => typeof id === "string" && COLLECTION_GID.test(id))) {
    errors.push("excludedCollectionIds must be a list of Shopify collection IDs");
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      thresholds,
      marginFloorPct: marginFloorPct as number,
      maxDiscountPct: maxDiscountPct as number,
      excludedCollectionIds: [...new Set(ids as string[])],
    },
  };
}
