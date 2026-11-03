// Seasonal products: the months a product sells in, from its tag (`season:nov-feb`, `season:11-2`,
// `season:winter`) or from a collection the merchant marked seasonal in Settings. Detection from sales
// history comes later (it needs a full year of orders). Pure (no imports) so node:test can load it.

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** Named seasons, northern hemisphere (the help text says so; month ranges work everywhere). */
const NAMED = { winter: [12, 2], spring: [3, 5], summer: [6, 8], autumn: [9, 11], fall: [9, 11] };
const DAY_MS = 86_400_000;

/** "nov", "november", "Nov." or "11" → 11; anything else → null. */
function month(text) {
  const t = String(text).trim().toLowerCase().replace(/\.$/, "");
  if (/^\d{1,2}$/.test(t)) {
    const n = Number(t);
    return n >= 1 && n <= 12 ? n : null;
  }
  const i = MONTHS.findIndex((m, k) => t === m || t === MONTH_NAMES[k].toLowerCase() || (t.length >= 3 && MONTH_NAMES[k].toLowerCase().startsWith(t)));
  return i >= 0 ? i + 1 : null;
}

/**
 * A season tag as `{ from, to }` (months 1–12, `to` may be earlier than `from` across the new year), or
 * null for any other tag. "season:nov-feb", "Season: November – February", "season:11-2", "season:dec",
 * "season:winter".
 */
export function parseSeasonTag(tag) {
  const m = /^\s*season\s*:\s*(.+?)\s*$/i.exec(String(tag ?? ""));
  if (!m) return null;
  const value = m[1].toLowerCase();
  if (Object.hasOwn(NAMED, value)) return { from: NAMED[value][0], to: NAMED[value][1] };
  const parts = value.split(/\s*(?:-|–|—|\bto\b)\s*/);
  if (parts.length === 1) {
    const one = month(parts[0]);
    return one ? { from: one, to: one } : null;
  }
  if (parts.length !== 2) return null;
  const from = month(parts[0]);
  const to = month(parts[1]);
  return from && to ? { from, to } : null;
}

const inRange = (m, r) => (r.from <= r.to ? m >= r.from && m <= r.to : m >= r.from || m <= r.to);

/**
 * Ranges joined where they overlap or touch (Jun–Aug + Sep–Oct is Jun–Oct; Dec–Feb + Nov–Jan is
 * Nov–Feb), in calendar order; [] when they cover the whole year (that isn't a season).
 */
export function mergeRanges(ranges) {
  const on = MONTHS.map((_, i) => ranges.some((r) => inRange(i + 1, r)));
  if (on.every(Boolean) || !on.some(Boolean)) return [];
  const merged = [];
  for (let i = 0; i < 12; i++) {
    if (!on[i] || on[(i + 11) % 12]) continue; // not the first month of a run
    let j = i;
    while (on[(j + 1) % 12]) j = (j + 1) % 12;
    merged.push({ from: i + 1, to: j + 1 });
  }
  return merged;
}

/**
 * A product's season: `{ ranges, source: "tag" | "collection", collectionId? }`, or null when it has
 * none (or its seasons cover the whole year). Tags win over collections. `seasonalCollections` are
 * `{ collectionId, from, to }` from Settings.
 */
export function seasonOf(product, seasonalCollections = []) {
  const tagged = (product.tags ?? []).map(parseSeasonTag).filter(Boolean);
  if (tagged.length) {
    const ranges = mergeRanges(tagged);
    return ranges.length ? { ranges, source: "tag" } : null;
  }
  const matches = (seasonalCollections ?? []).filter((c) => product.collections?.includes(c.collectionId));
  const ranges = mergeRanges(matches.map((c) => ({ from: c.from, to: c.to })));
  return ranges.length ? { ranges, source: "collection", collectionId: matches[0].collectionId } : null;
}

const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const daysBetween = (a, b) => Math.round((b.getTime() - a.getTime()) / DAY_MS);
const iso = (d) => d.toISOString().slice(0, 10);

/**
 * Where a day (`YYYY-MM-DD` in the store's calendar) falls in the given seasons:
 * - in season: `{ inSeason: true, start, end, daysIntoSeason }` (this occurrence's first and last day);
 * - out of season: `{ inSeason: false, nextStart, daysToStart, lastEnd, daysSinceEnd }`.
 * Dates are `YYYY-MM-DD`.
 */
export function seasonState(seasonRanges, dayKey) {
  const ranges = mergeRanges(seasonRanges ?? []);
  if (!ranges.length) return null; // no season, or all year
  const day = new Date(`${dayKey}T00:00:00Z`);
  const y = day.getUTCFullYear();
  const m = day.getUTCMonth() + 1;
  const current = ranges.find((r) => inRange(m, r));
  if (current) {
    // A season across the new year started last year when we're in its later months.
    const startYear = current.from <= m ? y : y - 1;
    const endYear = current.from <= current.to ? startYear : startYear + 1;
    const start = utc(startYear, current.from, 1);
    const end = utc(endYear, current.to, lastDay(endYear, current.to));
    return { inSeason: true, start: iso(start), end: iso(end), daysIntoSeason: daysBetween(start, day), seasonDays: daysBetween(start, end) + 1 };
  }
  const starts = ranges.map((r) => utc(r.from > m ? y : y + 1, r.from, 1));
  const nextStart = starts.reduce((a, b) => (b < a ? b : a));
  const ends = ranges.map((r) => {
    const endYear = r.to < m ? y : y - 1;
    return utc(endYear, r.to, lastDay(endYear, r.to));
  });
  const lastEnd = ends.reduce((a, b) => (b > a ? b : a));
  return { inSeason: false, nextStart: iso(nextStart), daysToStart: daysBetween(day, nextStart), lastEnd: iso(lastEnd), daysSinceEnd: daysBetween(lastEnd, day) };
}

/** Units sold per product on or after its season's start: `rows` `{ productId, date, units }`, `starts` productId → `YYYY-MM-DD`. */
export function unitsSinceStart(rows, starts) {
  const units = new Map();
  for (const r of rows) {
    const start = starts.get(r.productId);
    const day = r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date);
    if (start && day >= start) units.set(r.productId, (units.get(r.productId) ?? 0) + r.units);
  }
  return units;
}

/** The inbox reminds this many days before a season starts. */
export const REMINDER_DAYS = 30;
/** After a season ends with stock left, an end-of-season markdown is proposed for this many days. */
export const END_MARKDOWN_DAYS = 30;
/** ...but only when the next season is further away than a whole markdown (3 steps of 14 days) and then some. */
export const NEXT_SEASON_GAP_DAYS = 60;

/**
 * The season ended in the last 30 days and the next one is more than 60 days away: an end-of-season
 * markdown may clear what's left without running into the next season.
 */
export const justEnded = (state) =>
  Boolean(state) && !state.inSeason && state.daysSinceEnd <= END_MARKDOWN_DAYS && state.daysToStart > NEXT_SEASON_GAP_DAYS;

/**
 * What the inbox should say about seasons, from `items` `{ id, stock, stockValue, state }` (`state` from
 * `seasonState`): seasons starting within 30 days, grouped by start date, and seasons that ended in the
 * last 30 days with stock left, grouped by end date. Each group: `{ date, days, count, stockValue, productIds }`.
 */
export function seasonNotices(items) {
  const group = (list, dateOf, daysOf) => {
    const groups = new Map();
    for (const it of list) {
      const date = dateOf(it.state);
      const g = groups.get(date) ?? { date, days: daysOf(it.state), count: 0, stockValue: 0, productIds: [] };
      g.count += 1;
      g.stockValue = Math.round((g.stockValue + (it.stockValue ?? 0)) * 100) / 100;
      g.productIds.push(it.id);
      groups.set(date, g);
    }
    return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date));
  };
  const out = items.filter((it) => it.state && !it.state.inSeason);
  return {
    soon: group(out.filter((it) => it.state.daysToStart <= REMINDER_DAYS), (s) => s.nextStart, (s) => s.daysToStart),
    ended: group(out.filter((it) => justEnded(it.state) && it.stock > 0), (s) => s.lastEnd, (s) => s.daysSinceEnd),
  };
}

/** "Nov–Feb", "Dec", "Jun–Aug, Dec" for people. */
export function formatSeason(ranges) {
  const name = (n) => MONTH_NAMES[n - 1].slice(0, 3);
  return ranges.map((r) => (r.from === r.to ? name(r.from) : `${name(r.from)}–${name(r.to)}`)).join(", ");
}

/** "November" for a month number. */
export const monthName = (n) => MONTH_NAMES[n - 1];
