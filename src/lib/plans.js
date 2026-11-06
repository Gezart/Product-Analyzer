// Plans from docs/PLAN.md → "Pricing and billing". Relative imports only, so node:test can load it directly.

import { DAY_MS } from "./dates.js";

export const TRIAL_DAYS = 14;

export const PLANS = [
  { id: "free", name: "Free", price: 0, products: 25, diagnoses: 3, aiTexts: 0, aiPhotos: 0, features: ["Dashboard and statuses", "Diagnosis with evidence", "Rising stars", "Seasonal products", "Weekly plan in your inbox"] },
  { id: "starter", name: "Starter", price: 19, products: 250, diagnoses: 30, aiTexts: 30, aiPhotos: 0, features: ["Fix center with AI descriptions", "Rescue plans", "Markdown engine", "Collection Optimizer", "Market price (Google + competitors)"] },
  { id: "growth", name: "Growth", price: 39, products: 2000, diagnoses: 150, aiTexts: 150, aiPhotos: 50, features: ["AI photos", "Page builder for product pages", "A/B tests on product pages", "Compare", "Monthly report", "More AI each month"] },
  { id: "pro", name: "Pro", price: 79, products: Infinity, diagnoses: 500, aiTexts: 500, aiPhotos: 200, features: ["The most AI each month", "Priority support"] },
];

/** One trial per shop: days left from the first paid subscription, 0 once used up. */
export function remainingTrialDays(trialStartedAt, now = new Date()) {
  if (!trialStartedAt) return TRIAL_DAYS;
  const used = Math.floor((now.getTime() - trialStartedAt.getTime()) / DAY_MS);
  return Math.max(0, Math.min(TRIAL_DAYS, TRIAL_DAYS - used));
}

export const PAID_PLANS = PLANS.filter((p) => p.price > 0);

export function getPlan(id) {
  return PLANS.find((p) => p.id === id);
}

/** Maps active Shopify subscription names to our plan; no active paid subscription means Free. */
export function planFromSubscriptions(names) {
  for (const name of names) {
    const plan = PAID_PLANS.find((p) => p.name === name);
    if (plan) return plan.id;
  }
  return "free";
}

/** The plan each feature starts at; every plan includes the features of the plans below it. */
export const FEATURE_PLAN = { fixCenter: "starter", rescuePlans: "starter", markdown: "starter", marketPrice: "starter", aiDescriptions: "starter", collectionOrder: "starter", compare: "growth", reports: "growth", aiPhotos: "growth", pageBuilder: "growth", abTests: "growth" };

const rank = (planId) => Math.max(0, PLANS.findIndex((p) => p.id === planId));

/** Whether a shop on `planId` may use `feature` (unknown plans count as Free). */
export function hasFeature(planId, feature) {
  return rank(planId) >= rank(FEATURE_PLAN[feature]);
}

/** AI uses a plan includes each month: `kind` "texts" (descriptions) or "photos" (unknown plans count as Free). */
export function aiLimit(planId, kind) {
  const plan = getPlan(planId) ?? PLANS[0];
  return (kind === "photos" ? plan.aiPhotos : plan.aiTexts) ?? 0;
}

/** The next plan with more AI uses of `kind`, for the upgrade link; null on the top plan. */
export function aiUpgradePlan(planId, kind) {
  return PLANS.find((p) => aiLimit(p.id, kind) > aiLimit(planId, kind))?.id ?? null;
}

/** Products analyzed on a plan (unknown plans count as Free). */
export function productLimit(planId) {
  return (getPlan(planId) ?? PLANS[0]).products;
}

/**
 * Which products a plan analyzes when the catalog is over its limit. Products analyzed last time keep
 * their place (so the choice doesn't flip with small stock changes); free places go to the products
 * with the most money in stock (ties by id). Returns the set of ids kept.
 */
export function withinLimit(products, limit, analyzed = new Set()) {
  if (products.length <= limit) return new Set(products.map((p) => p.id));
  const sorted = [...products].sort(
    (a, b) => Number(analyzed.has(b.id)) - Number(analyzed.has(a.id)) || b.stockValue - a.stockValue || a.id.localeCompare(b.id),
  );
  return new Set(sorted.slice(0, limit).map((p) => p.id));
}
