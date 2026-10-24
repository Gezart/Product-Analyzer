import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { claimJob, completeJob, enqueue, failJob, pruneJobs } from "@/lib/jobs/queue";
import { handlers, nightlyJobs } from "@/lib/jobs/registry";
import { localDateKey, nextLocalRun } from "@/lib/jobs/schedule";

export class PermanentJobError extends Error {}

const workerId = `${process.env.FLY_MACHINE_ID ?? "local"}:${process.pid}:${randomUUID().slice(0, 8)}`;

/** Runs due jobs until none are left or `maxMs` has passed. Returns how many ran and failed. */
export async function runJobs({ maxMs }: { maxMs: number }) {
  const deadline = Date.now() + maxMs;
  let ran = 0;
  let failed = 0;
  while (Date.now() < deadline) {
    const job = await claimJob(workerId);
    if (!job) break;
    ran++;
    const handler = handlers[job.type];
    try {
      if (!handler) throw new PermanentJobError(`No handler for job type "${job.type}"`);
      await handler(job);
      await completeJob(job.id);
    } catch (error) {
      failed++;
      // Unknown types and permanent errors don't retry.
      await failJob(error instanceof PermanentJobError ? { ...job, attempts: job.maxAttempts } : job, error);
    }
  }
  return { ran, failed };
}

/**
 * Makes sure every installed shop has tonight's nightly jobs queued. Idempotent:
 * the unique key (type:shop:local date) stops duplicates, so it is safe to call every minute.
 */
export async function scheduleNightly(now = new Date()) {
  if (nightlyJobs.length === 0) return 0;
  const shops = await db().shop.findMany({ where: { uninstalledAt: null }, select: { id: true, timezone: true } });
  let added = 0;
  for (const shop of shops) {
    for (const { type, hour } of nightlyJobs) {
      const runAt = nextLocalRun(now, shop.timezone, hour);
      const uniqueKey = `${type}:${shop.id}:${localDateKey(runAt, shop.timezone)}`;
      if (await enqueue({ type, shopId: shop.id, runAt, uniqueKey })) added++;
    }
  }
  return added;
}

/** One scheduler pass + job drain; used by the in-process worker and the cron endpoint. */
export async function tick(maxMs: number) {
  const scheduled = await scheduleNightly();
  await pruneJobs();
  const result = await runJobs({ maxMs });
  return { scheduled, ...result };
}
