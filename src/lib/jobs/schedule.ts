// Pure time helpers for the job queue. No imports so node:test can load them directly.

const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 60 * 60_000;

/** Delay before the next try after `attempts` failed tries: 30s, 1m, 2m, … capped at 1h. */
export function backoffMs(attempts: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1), RETRY_MAX_MS);
}

/** What to do after a failed try: retry later, or give up when out of attempts or the error is permanent. */
export function retryPlan(attempts: number, maxAttempts: number, permanent: boolean, now: Date) {
  if (permanent || attempts >= maxAttempts) return { status: "failed" as const, runAt: null };
  return { status: "queued" as const, runAt: new Date(now.getTime() + backoffMs(attempts)) };
}

function safeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

/** Offset of `timeZone` from UTC at `date`, in ms (positive east of UTC). */
function offsetMs(date: Date, timeZone: string): number {
  const p = localParts(date, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * UTC instant of a wall-clock time in `timeZone`. Ambiguous times (clocks go back) take the earlier
 * instant; times that don't exist (clocks jump forward) take the later offset, i.e. the first valid
 * moment after the gap, so the result always falls on the requested local date.
 */
function zonedToUtc(year: number, month: number, day: number, hour: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour);
  // Offsets just before and after the target; ±1 day covers every zone (UTC−12 … UTC+14).
  const oneDay = 24 * 60 * 60 * 1000;
  const candidates = [
    guess - offsetMs(new Date(guess - oneDay), timeZone),
    guess - offsetMs(new Date(guess + oneDay), timeZone),
  ];
  const matches = candidates.filter((c) => {
    const p = localParts(new Date(c), timeZone);
    return p.year === year && p.month === month && p.day === day && p.hour === hour;
  });
  return new Date(matches.length ? Math.min(...matches) : Math.max(...candidates));
}

/** Local calendar date in `timeZone` as YYYY-MM-DD. */
export function localDateKey(date: Date, timeZone?: string | null): string {
  const p = localParts(date, safeZone(timeZone));
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/**
 * Next time it is `hour`:00 in `timeZone`, strictly after `now`, plus the local date it belongs to.
 * The date is the target date, not the date of `at`: if `hour` falls in a DST gap the run moves past
 * the gap (possibly into the next day) but still counts as that date's run. Unknown zones use UTC.
 */
export function nextLocalSlot(now: Date, timeZone: string | null | undefined, hour: number): { at: Date; date: string } {
  const zone = safeZone(timeZone);
  const p = localParts(now, zone);
  const key = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const today = zonedToUtc(p.year, p.month, p.day, hour, zone);
  if (today.getTime() > now.getTime()) return { at: today, date: key(p.year, p.month, p.day) };
  const t = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  const [y, m, d] = [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
  return { at: zonedToUtc(y, m, d, hour, zone), date: key(y, m, d) };
}

export function nextLocalRun(now: Date, timeZone: string | null | undefined, hour: number): Date {
  return nextLocalSlot(now, timeZone, hour).at;
}
