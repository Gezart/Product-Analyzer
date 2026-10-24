// Pure time helpers for the job queue. No imports so node:test can load them directly.

const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 60 * 60_000;

/** Delay before the next try after `attempts` failed tries: 30s, 1m, 2m, … capped at 1h. */
export function backoffMs(attempts: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1), RETRY_MAX_MS);
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

/** UTC instant of a wall-clock time in `timeZone` (DST-aware). */
function zonedToUtc(year: number, month: number, day: number, hour: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour);
  const first = guess - offsetMs(new Date(guess), timeZone);
  return new Date(guess - offsetMs(new Date(first), timeZone));
}

/** Local calendar date in `timeZone` as YYYY-MM-DD. */
export function localDateKey(date: Date, timeZone?: string | null): string {
  const p = localParts(date, safeZone(timeZone));
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Next time it is `hour`:00 in `timeZone`, strictly after `now`. Unknown zones fall back to UTC. */
export function nextLocalRun(now: Date, timeZone: string | null | undefined, hour: number): Date {
  const zone = safeZone(timeZone);
  const p = localParts(now, zone);
  const today = zonedToUtc(p.year, p.month, p.day, hour, zone);
  if (today.getTime() > now.getTime()) return today;
  const tomorrow = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  return zonedToUtc(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), hour, zone);
}
