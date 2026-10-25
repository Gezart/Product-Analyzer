// Merchant rules — docs/PLAN.md module 10. Validation is pure (relative import only) so node:test can load it.
import { round2 } from "./dates.js";
import { DEFAULT_THRESHOLDS } from "./scoring.js";

export const DEFAULT_SETTINGS = {
  thresholds: DEFAULT_THRESHOLDS,
  marginFloorPct: 10,
  maxDiscountPct: 40,
  excludedCollectionIds: [],
  excludedProductIds: [],
  markdownEndAction: "restore",
};

const THRESHOLD_RULES = {
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

function gidList(value, pattern) {
  if (!Array.isArray(value) || value.length > MAX_EXCLUDED) return null;
  if (!value.every((id) => typeof id === "string" && pattern.test(id))) return null;
  return [...new Set(value)];
}

function check(value, rule) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= rule.min &&
    value <= rule.max &&
    (!rule.integer || Number.isInteger(value))
  );
}

/**
 * Strict validation for the settings form: returns the clean settings or a list of field errors
 * (`{ field, min?, max?, integer? }`, which the form turns into a message with its own label and units).
 */
export function validateSettings(raw) {
  const errors = [];
  const input = (raw ?? {});
  const rawThresholds = (input.thresholds ?? {});

  const thresholds = { ...DEFAULT_THRESHOLDS };
  for (const key of Object.keys(THRESHOLD_RULES)) {
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
      marginFloorPct: round2(marginFloorPct),
      maxDiscountPct: round2(maxDiscountPct),
      excludedCollectionIds: excludedCollectionIds,
      excludedProductIds: excludedProductIds,
      markdownEndAction: endAction,
    },
  };
}
