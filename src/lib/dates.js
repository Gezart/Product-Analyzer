// Calendar helpers shared by the analysis code. Dates are local store dates as "YYYY-MM-DD" strings;
// they are handled as UTC midnights so day arithmetic never shifts across time zones. Pure (no imports).

export const DAY_MS = 86_400_000;

/** `date` ("YYYY-MM-DD") moved by `days` (negative goes back). */
export function shiftDate(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` ("YYYY-MM-DD"; negative when `to` is earlier). */
export function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** A stored calendar date (Prisma `@db.Date`, a UTC midnight) as "YYYY-MM-DD". */
export function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" as the UTC-midnight Date that Prisma `@db.Date` columns use. */
export function asDate(key) {
  return new Date(`${key}T00:00:00Z`);
}

/** Rounded to cents. */
export function round2(n) {
  return Math.round(n * 100) / 100;
}
