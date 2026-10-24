import type { ClaimedJob } from "@/lib/jobs/queue";
import { PermanentJobError } from "@/lib/jobs/errors";
import { scoreShop } from "@/lib/score-shop";

/**
 * A job handler. It must be idempotent (a job can run again after a crash or timeout) and should
 * stop when `signal` aborts (timeout or shutdown). Throw `PermanentJobError` when retrying can't help.
 */
export type JobHandler = (job: ClaimedJob, signal: AbortSignal) => Promise<void>;

function requireShop(job: ClaimedJob): string {
  if (!job.shopId) throw new PermanentJobError(`${job.type} needs a shop`);
  return job.shopId;
}

/** Job type → handler. Feature tasks register their handlers here. */
export const handlers: Record<string, JobHandler> = {
  /** Recompute statuses and money at stake (after settings change or new data). */
  "score-shop": async (job) => {
    await scoreShop(requireShop(job));
  },
};

/** Jobs enqueued once per shop per night, at `hour`:00 in the store's timezone. */
export const nightlyJobs: { type: string; hour: number }[] = [];
