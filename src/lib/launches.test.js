import assert from "node:assert/strict";
import { test } from "node:test";
import { dueCheckpoint, judgeLaunch, launchWindow, storeBenchmarks } from "./launches.js";

const day = (n) => ({ date: `2026-11-${String(n).padStart(2, "0")}` });

test("checkpoints at 7, 14 and 30 days; a product found late gets only its latest", () => {
  assert.equal(dueCheckpoint("2026-11-01", "2026-11-07"), null);
  assert.equal(dueCheckpoint("2026-11-01", "2026-11-08"), 7);
  assert.equal(dueCheckpoint("2026-11-01", "2026-11-09", [7]), null);
  assert.equal(dueCheckpoint("2026-11-01", "2026-11-15", [7]), 14);
  // Found on day 20 with nothing recorded: day 14 only, not 7 as well.
  assert.equal(dueCheckpoint("2026-11-01", "2026-11-21"), 14);
  assert.equal(dueCheckpoint("2026-10-01", "2026-11-05", [7, 14]), 30);
  assert.equal(dueCheckpoint("2026-10-01", "2026-11-05", [30]), null);
});

test("a launch's numbers: its first days, never today's unfinished one", () => {
  const rows = [
    { ...day(1), viewSessions: 50, cartSessions: 2, purchaseSessions: 1, units: 1, revenue: "20.00" },
    { ...day(5), viewSessions: 30, cartSessions: 1, purchaseSessions: 0, units: 0, revenue: 0 },
    { ...day(8), viewSessions: 99, cartSessions: 9, purchaseSessions: 9, units: 9, revenue: 900 }, // after day 7
    { ...day(10), viewSessions: 5, cartSessions: 5, purchaseSessions: 0, units: 0, revenue: 0 },
  ];
  assert.deepEqual(launchWindow(rows, "2026-11-01", 7, "2026-11-20"), { views: 80, carts: 3, buyers: 1, units: 1, revenue: 20, days: 7, cartRate: 3 / 80 });
  // Day 10 is today: not counted yet.
  const sofar = launchWindow(rows, "2026-11-01", 30, "2026-11-10");
  assert.deepEqual([sofar.days, sofar.views], [9, 179]);
});

test("the store's yardsticks: median add-to-cart rate of products with visits, median daily visits", () => {
  const store = storeBenchmarks([
    { views: 300, carts: 30 },
    { views: 600, carts: 30 },
    { views: 900, carts: 90 },
    { views: 10, carts: 5 }, // too few visits for the rate
    { views: 0, carts: 0 },
  ]);
  assert.equal(store.viewsKnown, true);
  assert.equal(store.cartRate, 0.1);
  assert.equal(store.dailyViews, 10);
  assert.deepEqual(storeBenchmarks([{ views: 0, carts: 0 }]), { viewsKnown: false, cartRate: null, dailyViews: null });
});

test("a launch is judged against the store", () => {
  const store = { viewsKnown: true, cartRate: 0.08, dailyViews: 20 };
  const w = (views, carts, units = 0, days = 7) => ({ views, carts, units, days, cartRate: views ? carts / views : null });
  // The example from the features page: 410 visits, 2 add-to-carts, store 8%.
  assert.deepEqual(judgeLaunch(w(410, 2), store), { status: "page_problem", reason: "410 visits, 0.5% added to cart (store: 8.0%)." });
  assert.equal(judgeLaunch(w(410, 60, 5), store).status, "strong");
  assert.equal(judgeLaunch(w(410, 60, 0), store).status, "on_track"); // carts but no sale yet: not "strong"
  assert.equal(judgeLaunch(w(200, 14), store).status, "on_track");
  // 12 visits in 7 days where a typical product gets 140: few visits.
  assert.deepEqual(judgeLaunch(w(12, 0), store), { status: "no_traffic", reason: "12 visits in 7 days; a typical product gets about 140." });
  // 25 visits in a small store (typical 2 a day): too early, not "few visits".
  assert.equal(judgeLaunch(w(25, 0), { ...store, dailyViews: 2 }).status, "not_enough_data");
  // No visit data in the store: sales only.
  assert.equal(judgeLaunch(w(0, 0, 3), { viewsKnown: false, cartRate: null, dailyViews: null }).status, "on_track");
  assert.equal(judgeLaunch(w(0, 0, 0), { viewsKnown: false, cartRate: null, dailyViews: null }).status, "not_enough_data");
  // The edges: exactly half the store's rate isn't a problem; exactly 1.5× with a sale is strong.
  assert.equal(judgeLaunch(w(100, 4), store).status, "on_track");
  assert.equal(judgeLaunch(w(100, 3), store).status, "page_problem");
  assert.equal(judgeLaunch(w(100, 12, 1), store).status, "strong");
  // Visits known but too few products to set the store's rate: on track with a sale, else too early.
  const noRate = { viewsKnown: true, cartRate: null, dailyViews: 20 };
  assert.equal(judgeLaunch(w(80, 2, 1), noRate).status, "on_track");
  assert.equal(judgeLaunch(w(80, 2, 0), noRate).status, "not_enough_data");
});
