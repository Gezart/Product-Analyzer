import type { ClaimedJob } from "@/lib/jobs/queue";

/**
 * A job handler. It must be idempotent (a job can run again after a crash or timeout) and should
 * stop when `signal` aborts (timeout or shutdown). Throw `PermanentJobError` when retrying can't help.
 */
export type JobHandler = (job: ClaimedJob, signal: AbortSignal) => Promise<void>;

/** Job type → handler. Feature tasks register their handlers here (e.g. "daily-metrics"). */
export const handlers: Record<string, JobHandler> = {};

/** Jobs enqueued once per shop per night, at `hour`:00 in the store's timezone. */
export const nightlyJobs: { type: string; hour: number }[] = [];
