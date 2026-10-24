import type { ClaimedJob } from "@/lib/jobs/queue";

export type JobHandler = (job: ClaimedJob) => Promise<void>;

/** Job type → handler. Feature tasks register their handlers here (e.g. "daily-metrics"). */
export const handlers: Record<string, JobHandler> = {};

/** Jobs enqueued once per shop per night, at `hour`:00 in the store's timezone. */
export const nightlyJobs: { type: string; hour: number }[] = [];
