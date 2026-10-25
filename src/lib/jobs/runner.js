import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { JobTimeoutError, PermanentJobError } from "@/lib/jobs/errors";
import { claimJob, completeJob, enqueue, failJob, LOCK_TIMEOUT_MINUTES, pruneJobs, releaseJob } from "@/lib/jobs/queue";
import { handlers, hourlyJobs, nightlyJobs } from "@/lib/jobs/registry";
import { nextLocalSlot } from "@/lib/jobs/schedule";

/** Must stay well below the lock timeout so a slow handler is stopped before its lock can expire. */
const HANDLER_TIMEOUT_MS = Math.floor((LOCK_TIMEOUT_MINUTES * 60_000) / 2);
const SCHEDULE_EVERY_MS = 10 * 60_000;

const workerId = `${process.env.FLY_MACHINE_ID ?? "local"}:${process.pid}:${randomUUID().slice(0, 8)}`;

let stopping = false;
let current = null;
let lastScheduledAt = 0;

/** Stops claiming new jobs and aborts the running one (it is put back without counting the try). */
export function stopJobs() {
  stopping = true;
  current?.abort(new Error("Worker stopping"));
}

async function runHandler(handler, job) {
  const controller = new AbortController();
  current = controller;
  const timer = setTimeout(
    () => controller.abort(new JobTimeoutError(`Timed out after ${HANDLER_TIMEOUT_MS / 1000}s`)),
    HANDLER_TIMEOUT_MS,
  );
  const aborted = new Promise((_, reject) =>
    controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true }),
  );
  try {
    await Promise.race([handler(job, controller.signal), aborted]);
  } finally {
    clearTimeout(timer);
    current = null;
  }
}

async function shopIsActive(shopId) {
  const shop = await db().shop.findUnique({ where: { id: shopId }, select: { uninstalledAt: true } });
  return shop != null && shop.uninstalledAt == null;
}

/** Runs due jobs until none are left or `maxMs` has passed. Returns how many ran and failed. */
export async function runJobs({ maxMs }) {
  const deadline = Date.now() + maxMs;
  let ran = 0;
  let failed = 0;
  while (!stopping && Date.now() < deadline) {
    const job = await claimJob(workerId);
    if (!job) break;
    ran++;
    if (stopping) {
      await releaseJob(job, workerId, "Worker stopped");
      break;
    }
    try {
      if (job.shopId && !(await shopIsActive(job.shopId))) throw new PermanentJobError("Shop uninstalled");
      // Unknown type retries with backoff: during a rolling deploy an old machine may claim a new type.
      const handler = handlers[job.type];
      if (!handler) throw new Error(`No handler for job type "${job.type}"`);
      await runHandler(handler, job);
      await completeJob(job, workerId);
    } catch (error) {
      failed++;
      console.error(`[jobs] ${job.type} failed (attempt ${job.attempts ?? "?"}):`, error instanceof Error ? error.message : error);
      if (stopping) await releaseJob(job, workerId, "Worker stopped");
      // A timed-out handler that ignores its signal may still be running: retry only after its lock would expire.
      else if (error instanceof JobTimeoutError) await failJob(job, workerId, error, new Date(), LOCK_TIMEOUT_MINUTES * 60_000);
      else await failJob(job, workerId, error);
    }
  }
  return { ran, failed };
}

/**
 * Makes sure every installed shop has its next nightly and hourly jobs queued. Idempotent:
 * the unique key (type:shop:local date) stops duplicates.
 */
export async function scheduleNightly(now = new Date()) {
  if (nightlyJobs.length === 0 && hourlyJobs.length === 0) return 0;
  const shops = await db().shop.findMany({ where: { uninstalledAt: null }, select: { id: true, timezone: true } });
  // Hourly jobs run at the next full hour (UTC); one per shop per hour.
  const nextHour = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000 + 3_600_000);
  let added = 0;
  for (const shop of shops) {
    for (const { type, hour } of nightlyJobs) {
      const slot = nextLocalSlot(now, shop.timezone, hour);
      const uniqueKey = `${type}:${shop.id}:${slot.date}`;
      if (await enqueue({ type, shopId: shop.id, runAt: slot.at, uniqueKey })) added++;
    }
    for (const type of hourlyJobs) {
      const uniqueKey = `${type}:${shop.id}:${nextHour.toISOString().slice(0, 13)}`;
      if (await enqueue({ type, shopId: shop.id, runAt: nextHour, uniqueKey })) added++;
    }
  }
  return added;
}

/** Scheduler pass (at most every 10 min) + job drain; used by the in-process worker and the cron endpoint. */
export async function tick(maxMs) {
  let scheduled = 0;
  if (Date.now() - lastScheduledAt >= SCHEDULE_EVERY_MS) {
    lastScheduledAt = Date.now();
    scheduled = await scheduleNightly();
    await pruneJobs();
  }
  const result = await runJobs({ maxMs });
  return { scheduled, ...result };
}
