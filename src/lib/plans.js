// Plans from docs/PLAN.md → "Pricing and billing". Relative imports only, so node:test can load it directly.

import { DAY_MS } from "./dates.js";

export const TRIAL_DAYS = 14;

export const PLANS = [
  { id: "free", name: "Free", price: 0, products: 25, diagnoses: 3, features: ["Dashboard", "Statuses", "Diagnosis"] },
  { id: "starter", name: "Starter", price: 19, products: 250, diagnoses: 30, features: ["Fix center", "Rescue plans", "Markdown engine"] },
  { id: "growth", name: "Growth", price: 39, products: 2000, diagnoses: 150, features: ["Compare", "Monthly reports"] },
  { id: "pro", name: "Pro", price: 79, products: Infinity, diagnoses: 500, features: ["Bulk fixes", "Priority support"] },
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
export const FEATURE_PLAN = { fixCenter: "starter", rescuePlans: "starter", markdown: "starter", compare: "growth", reports: "growth" };

const rank = (planId) => Math.max(0, PLANS.findIndex((p) => p.id === planId));

/** Whether a shop on `planId` may use `feature` (unknown plans count as Free). */
export function hasFeature(planId, feature) {
  return rank(planId) >= rank(FEATURE_PLAN[feature]);
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
