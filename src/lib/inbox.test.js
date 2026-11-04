import assert from "node:assert/strict";
import { test } from "node:test";
import { kindOf, lastWeekLines, planRow, whenLabel } from "./inbox.js";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const action = (kind, text, extra = {}) => ({ productId: "p1", title: "Leather Jacket", status: "slow_mover", moneyAtStake: 1800, kind, text, href: "/products/p1#page", ...extra });

test("each weekly plan move as a row: what to do, why, and its button", () => {
  assert.deepEqual(planRow(action("fix_page", "What holds it back: too few images."), money), {
    title: "Fix what holds Leather Jacket back",
    why: "€1,800 at stake · Too few images",
    cta: "See why",
    href: "/products/p1#page",
  });
  assert.deepEqual(planRow(action("reorder", "Reorder: about 6 days of stock left.", { moneyAtStake: 0, href: "/products/p1#variants" }), money), {
    title: "Reorder Leather Jacket",
    why: "About 6 days of stock left",
    cta: "See stock",
    href: "/products/p1#variants",
  });
  assert.equal(planRow(action("markdown", "Start the markdown. Dead stock: no sale for a long time."), money).why, "€1,800 at stake · Dead stock: no sale for a long time");
  assert.equal(planRow(action("visibility", "…"), money).cta, "Open Collections");
  assert.equal(planRow(action("diagnose", "…"), money).title, "Find out why Leather Jacket isn't selling");
  assert.deepEqual(planRow(action("future_kind", "Something new.", { moneyAtStake: 0 }), money), { title: "Leather Jacket", why: "Something new", cta: "Open", href: "/products/p1#page" });
});

test("last week's lines: improved fixes together, then each other result and the markdowns", () => {
  const lines = lastWeekLines(
    {
      verdicts: [
        { productId: "a", title: "Slim Jeans", verdict: "improved", extraSales: 300 },
        { productId: "b", title: "Tee", verdict: "improved", extraSales: 120 },
        { productId: "c", title: "Scarf", verdict: "worse" },
      ],
      extraSales: 420,
      markdownsStarted: [{ productId: "d", title: "Wool Coat" }],
      markdownsEnded: [{ productId: "e", title: "Belt", endReason: "stock_cleared" }],
    },
    money,
  );
  assert.deepEqual(lines[0], { before: "2 fixes came back ", strong: "Improved", after: ": about €420 in extra sales.", products: [{ productId: "a", title: "Slim Jeans" }, { productId: "b", title: "Tee" }] });
  assert.deepEqual(lines[1], { before: "", product: { productId: "c", title: "Scarf" }, after: ": Worse. Undo the fixes on its page." });
  assert.equal(lines[2].before, "Markdown started for ");
  assert.equal(lines[3].after, " (the stock cleared).");
  assert.deepEqual(lastWeekLines(null, money), []);
  assert.equal(lastWeekLines({ verdicts: [{ productId: "a", title: "A", verdict: "improved", extraSales: 0 }], extraSales: 0 }, money)[0].after, ".");
});

test("a notification's look, with a rescue verdict's tone following the verdict", () => {
  assert.deepEqual(kindOf("markdown_paused"), { icon: "pause", tone: "warn", label: "Markdown" });
  assert.equal(kindOf("rescue_verdict", "worse").tone, "bad");
  assert.equal(kindOf("rescue_verdict", "improved").tone, "good");
  assert.equal(kindOf("rescue_verdict", "no_change").tone, "warn");
  assert.deepEqual(kindOf("something_new"), { icon: "bell", tone: "info", label: "Update" });
});

test("when: minutes and hours today, yesterday, then the date", () => {
  const now = new Date("2026-11-04T15:00:00Z");
  assert.equal(whenLabel("2026-11-04T14:59:40Z", now, "UTC"), "Just now");
  assert.equal(whenLabel("2026-11-04T14:55:00Z", now, "UTC"), "5 min ago");
  assert.equal(whenLabel("2026-11-04T13:00:00Z", now, "UTC"), "2 h ago");
  assert.equal(whenLabel("2026-11-03T09:00:00Z", now, "UTC"), "Yesterday");
  assert.equal(whenLabel("2026-10-20T09:00:00Z", now, "UTC"), "Oct 20");
  assert.equal(whenLabel("2025-12-20T09:00:00Z", now, "UTC"), "Dec 20, 2025");
});
