// Plans from docs/PLAN.md → "Pricing and billing". No imports so node:test can load it directly.

export const TRIAL_DAYS = 14;

export const PLANS = [
  { id: "free", name: "Free", price: 0, products: 25, diagnoses: 3, features: ["Dashboard", "Statuses", "Diagnosis"] },
  { id: "starter", name: "Starter", price: 19, products: 250, diagnoses: 30, features: ["Fix center", "Rescue plans", "Markdown engine"] },
  { id: "growth", name: "Growth", price: 39, products: 2000, diagnoses: 150, features: ["Compare", "Monthly reports"] },
  { id: "pro", name: "Pro", price: 79, products: Infinity, diagnoses: 500, features: ["Bulk fixes", "Priority support"] },
];

const DAY_MS = 24 * 60 * 60 * 1000;

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
