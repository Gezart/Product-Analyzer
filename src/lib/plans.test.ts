import assert from "node:assert/strict";
import { test } from "node:test";
import { PLANS, getPlan, planFromSubscriptions, remainingTrialDays } from "./plans.ts";

test("plans match the pricing table", () => {
  assert.deepEqual(
    PLANS.map((p) => [p.id, p.price, p.products, p.diagnoses]),
    [
      ["free", 0, 25, 3],
      ["starter", 19, 250, 30],
      ["growth", 39, 2000, 150],
      ["pro", 79, Infinity, 500],
    ],
  );
});

test("getPlan finds known plans only", () => {
  assert.equal(getPlan("growth")?.price, 39);
  assert.equal(getPlan("enterprise"), undefined);
});

test("planFromSubscriptions maps Shopify names", () => {
  assert.equal(planFromSubscriptions([]), "free");
  assert.equal(planFromSubscriptions(["Starter"]), "starter");
  assert.equal(planFromSubscriptions(["Unknown", "Pro"]), "pro");
  assert.equal(planFromSubscriptions(["Free"]), "free");
});

test("trial is given once per shop", () => {
  const now = new Date("2026-10-24T12:00:00Z");
  const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
  assert.equal(remainingTrialDays(null, now), 14);
  assert.equal(remainingTrialDays(daysAgo(0), now), 14);
  assert.equal(remainingTrialDays(daysAgo(13), now), 1);
  assert.equal(remainingTrialDays(daysAgo(14), now), 0);
  assert.equal(remainingTrialDays(daysAgo(100), now), 0);
  assert.equal(remainingTrialDays(daysAgo(-3), now), 14);
});
