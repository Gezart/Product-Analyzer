import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { PermanentJobError } from "@/lib/jobs/errors";
import { retryPlan } from "@/lib/jobs/schedule";

/** A running job whose lock is older than this is considered crashed and is requeued. Handlers time out well before it. */
export const LOCK_TIMEOUT_MINUTES = 10;

export type ClaimedJob = {
  id: string;
  shopId: string | null;
  type: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
};

export type EnqueueInput = {
  type: string;
  shopId?: string | null;
  payload?: Prisma.InputJsonValue;
  runAt?: Date;
  /** Same key twice is a no-op. */
  uniqueKey?: string;
  maxAttempts?: number;
};

/** Adds a job. Returns false when a job with the same `uniqueKey` already exists. */
export async function enqueue(input: EnqueueInput): Promise<boolean> {
  const { count } = await db().job.createMany({
    data: [
      {
        type: input.type,
        shopId: input.shopId ?? null,
        payload: input.payload ?? {},
        runAt: input.runAt ?? new Date(),
        uniqueKey: input.uniqueKey ?? null,
        maxAttempts: input.maxAttempts ?? 5,
      },
    ],
    skipDuplicates: true,
  });
  return count > 0;
}

/** Crashed workers leave jobs "running"; requeue them (or fail them when out of attempts). */
async function releaseStaleJobs() {
  await db().$executeRaw`
    UPDATE "jobs" SET
      "status" = CASE WHEN "attempts" >= "max_attempts" THEN 'failed' ELSE 'queued' END,
      "finished_at" = CASE WHEN "attempts" >= "max_attempts" THEN (now() AT TIME ZONE 'UTC') ELSE NULL END,
      "locked_at" = NULL,
      "locked_by" = NULL,
      "last_error" = 'Worker lock expired'
    WHERE "status" = 'running'
      AND "locked_at" < (now() AT TIME ZONE 'UTC') - make_interval(mins => ${LOCK_TIMEOUT_MINUTES})
  `;
}

function isUniqueViolation(error: unknown) {
  // Raw queries through the pg driver adapter surface as P2010 with the Postgres code in meta.
  const cause = (error as { meta?: { driverAdapterError?: { cause?: { originalCode?: string } } } })?.meta
    ?.driverAdapterError?.cause;
  return cause?.originalCode === "23505";
}

/**
 * Atomically claims the next due job. SKIP LOCKED lets several workers run side by side.
 * One running job per shop is guaranteed by the partial unique index `jobs_one_running_per_shop`;
 * the NOT EXISTS check and advisory lock just make collisions rare (a collision is retried).
 * Timestamps are compared in UTC because Prisma stores `timestamp(3)` without a zone.
 */
export async function claimJob(workerId: string): Promise<ClaimedJob | null> {
  await releaseStaleJobs();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const rows = await db().$queryRaw<ClaimedJob[]>`
        UPDATE "jobs" SET
          "status" = 'running',
          "locked_at" = (now() AT TIME ZONE 'UTC'),
          "locked_by" = ${workerId},
          "attempts" = "attempts" + 1
        WHERE "id" = (
          SELECT j."id" FROM "jobs" j
          WHERE j."status" = 'queued' AND j."run_at" <= (now() AT TIME ZONE 'UTC')
          AND (
            j."shop_id" IS NULL OR (
              NOT EXISTS (SELECT 1 FROM "jobs" r WHERE r."shop_id" = j."shop_id" AND r."status" = 'running')
              AND pg_try_advisory_xact_lock(hashtext(j."shop_id"))
            )
          )
          ORDER BY j."run_at"
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING "id", "shop_id" AS "shopId", "type", "payload", "attempts", "max_attempts" AS "maxAttempts"
      `;
      return rows[0] ?? null;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  return null;
}

// Completion is guarded by the worker's lock: if the job was released (lock expired) or deleted
// (shop redacted) meanwhile, the update is a no-op instead of overwriting another worker's run.
function ownedBy(job: ClaimedJob, workerId: string) {
  return { id: job.id, status: "running", lockedBy: workerId };
}

export async function completeJob(job: ClaimedJob, workerId: string) {
  await db().job.updateMany({
    where: ownedBy(job, workerId),
    data: { status: "done", finishedAt: new Date(), lockedAt: null, lockedBy: null, lastError: null },
  });
}

/** Retries with backoff until `maxAttempts`; `PermanentJobError` fails at once. */
export async function failJob(job: ClaimedJob, workerId: string, error: unknown, now = new Date(), minDelayMs = 0) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const plan = retryPlan(job.attempts, job.maxAttempts, error instanceof PermanentJobError, now);
  if (plan.runAt && plan.runAt.getTime() < now.getTime() + minDelayMs) plan.runAt = new Date(now.getTime() + minDelayMs);
  await db().job.updateMany({
    where: ownedBy(job, workerId),
    data: {
      status: plan.status,
      runAt: plan.runAt ?? undefined,
      finishedAt: plan.status === "failed" ? now : null,
      lockedAt: null,
      lockedBy: null,
      lastError: message.slice(0, 2000),
    },
  });
}

/** Puts a job back without counting the try (worker shutting down). */
export async function releaseJob(job: ClaimedJob, workerId: string, reason: string) {
  await db().job.updateMany({
    where: ownedBy(job, workerId),
    data: { status: "queued", attempts: { decrement: 1 }, lockedAt: null, lockedBy: null, lastError: reason },
  });
}

/** Drops queued work for a shop (on uninstall). Running jobs finish on their own. */
export async function cancelShopJobs(shopId: string) {
  await db().job.deleteMany({ where: { shopId, status: "queued" } });
}

/** Removes finished jobs older than `days` so the table stays small. Unique keys of recent runs are kept. */
export async function pruneJobs(days = 30, now = new Date()) {
  await db().job.deleteMany({
    where: { status: { in: ["done", "failed"] }, finishedAt: { lt: new Date(now.getTime() - days * 86_400_000) } },
  });
}
