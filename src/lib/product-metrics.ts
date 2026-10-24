// Per-product analysis — docs/PLAN.md module 3. Pure (no imports) so node:test can load it.

export type DailyRow = {
  date: string; // YYYY-MM-DD (store's local date)
  units: number;
  revenue: number;
  viewSessions: number;
  cartSessions: number;
  purchaseSessions: number;
};

export type WindowTotals = {
  days: number;
  units: number;
  revenue: number;
  views: number;
  viewToCart: number | null;
  viewToPurchase: number | null;
};

const DAY_MS = 86_400_000;
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** Totals for the `days` days before `today` (today itself is incomplete and left out). */
export function windowTotals(rows: DailyRow[], today: string, days: number): WindowTotals {
  const from = shift(today, -days);
  const inWindow = rows.filter((r) => r.date >= from && r.date < today);
  const sum = (key: keyof Omit<DailyRow, "date">) => inWindow.reduce((s, r) => s + r[key], 0);
  const views = sum("viewSessions");
  return {
    days,
    units: sum("units"),
    revenue: Math.round(sum("revenue") * 100) / 100,
    views,
    viewToCart: views > 0 ? sum("cartSessions") / views : null,
    viewToPurchase: views > 0 ? sum("purchaseSessions") / views : null,
  };
}

/**
 * One entry per day for the last `days` days before `today`, missing days as 0 (for the chart).
 * Days older than `knownDays` (before order history starts) are marked unknown, not "no sales".
 */
export function dailySeries(rows: DailyRow[], today: string, days: number, knownDays = days) {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  return Array.from({ length: days }, (_, i) => {
    const date = shift(today, i - days);
    const r = byDate.get(date);
    return { date, units: r?.units ?? 0, revenue: r?.revenue ?? 0, known: days - i <= knownDays };
  });
}

/** Units in the last 30 days ÷ the 30 days before; null when the earlier window had no sales. */
export function trend30(rows: DailyRow[], today: string): number | null {
  const last = windowTotals(rows, today, 30).units;
  const previous = windowTotals(rows, today, 60).units - last;
  return previous > 0 ? last / previous : null;
}

/** Latest day with a sale, or null. */
export function lastSaleDate(rows: DailyRow[]): string | null {
  return rows.reduce<string | null>((latest, r) => (r.units > 0 && (!latest || r.date > latest) ? r.date : latest), null);
}
