import assert from "node:assert/strict";
import { test } from "node:test";
import { formatSeason, parseSeasonTag, seasonOf, seasonState } from "./season.js";

test("season tags: month ranges, single months, numbers and named seasons", () => {
  assert.deepEqual(parseSeasonTag("season:nov-feb"), { from: 11, to: 2 });
  assert.deepEqual(parseSeasonTag("Season: November – February"), { from: 11, to: 2 });
  assert.deepEqual(parseSeasonTag("season:11-2"), { from: 11, to: 2 });
  assert.deepEqual(parseSeasonTag("season: jun to aug"), { from: 6, to: 8 });
  assert.deepEqual(parseSeasonTag("season:dec"), { from: 12, to: 12 });
  assert.deepEqual(parseSeasonTag("SEASON:Winter"), { from: 12, to: 2 });
  assert.deepEqual(parseSeasonTag("season:summer"), { from: 6, to: 8 });
  assert.deepEqual(parseSeasonTag("season:sept-oct"), { from: 9, to: 10 });
  for (const other of ["winter", "sale", "season:", "season:13-2", "season:ma-jun", "season:nov-feb-mar", "season:christmas", null, ""]) {
    assert.equal(parseSeasonTag(other), null, String(other));
  }
});

test("a product's season: its tags first, else a seasonal collection; never the whole year", () => {
  const collections = [{ collectionId: "gid://shopify/Collection/1", from: 6, to: 8 }];
  assert.deepEqual(seasonOf({ tags: ["sale", "season:nov-feb"], collections: ["gid://shopify/Collection/1"] }, collections), { ranges: [{ from: 11, to: 2 }], source: "tag" });
  assert.deepEqual(seasonOf({ tags: ["sale"], collections: ["gid://shopify/Collection/1"] }, collections), {
    ranges: [{ from: 6, to: 8 }],
    source: "collection",
    collectionId: "gid://shopify/Collection/1",
  });
  assert.equal(seasonOf({ tags: [], collections: ["gid://shopify/Collection/2"] }, collections), null);
  assert.equal(seasonOf({ tags: ["season:jan-dec"], collections: [] }), null, "all year isn't a season");
  assert.equal(seasonOf({ tags: ["season:jan-jun", "season:jul-dec"], collections: [] }), null);
  assert.deepEqual(seasonOf({ tags: ["season:winter", "season:dec-feb", "season:jun"], collections: [] }).ranges, [{ from: 12, to: 2 }, { from: 6, to: 6 }]);
});

test("in season: this occurrence's first and last day, also across the new year", () => {
  const winter = [{ from: 11, to: 2 }];
  assert.deepEqual(seasonState(winter, "2026-11-20"), { inSeason: true, start: "2026-11-01", end: "2027-02-28", daysIntoSeason: 19 });
  assert.deepEqual(seasonState(winter, "2027-01-15"), { inSeason: true, start: "2026-11-01", end: "2027-02-28", daysIntoSeason: 75 });
  assert.deepEqual(seasonState(winter, "2028-02-29"), { inSeason: true, start: "2027-11-01", end: "2028-02-29", daysIntoSeason: 120 });
  assert.deepEqual(seasonState([{ from: 6, to: 8 }], "2026-06-01"), { inSeason: true, start: "2026-06-01", end: "2026-08-31", daysIntoSeason: 0 });
});

test("out of season: the next start and the last end", () => {
  assert.deepEqual(seasonState([{ from: 11, to: 2 }], "2026-07-10"), { inSeason: false, nextStart: "2026-11-01", daysToStart: 114, lastEnd: "2026-02-28", daysSinceEnd: 132 });
  assert.deepEqual(seasonState([{ from: 11, to: 2 }], "2026-03-01"), { inSeason: false, nextStart: "2026-11-01", daysToStart: 245, lastEnd: "2026-02-28", daysSinceEnd: 1 });
  assert.deepEqual(seasonState([{ from: 6, to: 8 }], "2026-12-31"), { inSeason: false, nextStart: "2027-06-01", daysToStart: 152, lastEnd: "2026-08-31", daysSinceEnd: 122 });
  // Two seasons: the nearer start and the latest end.
  assert.deepEqual(seasonState([{ from: 6, to: 6 }, { from: 12, to: 12 }], "2026-09-15"), { inSeason: false, nextStart: "2026-12-01", daysToStart: 77, lastEnd: "2026-06-30", daysSinceEnd: 77 });
});

test("seasons for people", () => {
  assert.equal(formatSeason([{ from: 11, to: 2 }]), "Nov–Feb");
  assert.equal(formatSeason([{ from: 6, to: 8 }, { from: 12, to: 12 }]), "Jun–Aug, Dec");
});
