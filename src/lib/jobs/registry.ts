import type { ClaimedJob } from "@/lib/jobs/queue";
import { PermanentJobError } from "@/lib/jobs/errors";
import { guardPrices, runMarkdownPlans } from "@/lib/markdown-engine";
import { runRescuePlans } from "@/lib/rescue-plans";
import { scoreShop } from "@/lib/score-shop";
import { runDailyMetrics, runInitialSync, runOrdersCatchup, runRegisterWebhooks, runSyncPoll } from "@/lib/sync/initial-sync";
import { runSyncInventory, runSyncProduct } from "@/lib/sync/live";

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
  /** First full import after install: shop info → products bulk query → orders bulk query → score. */
  "initial-sync": runInitialSync,
  "sync-poll": runSyncPoll,
  "register-webhooks": runRegisterWebhooks,
  "orders-catchup": runOrdersCatchup,
  "daily-metrics": runDailyMetrics,
  /** Plan runner: closes measurement windows, applies markdown steps, restores prices, guards floors. */
  "rescue-runner": async (job) => {
    await runRescuePlans(requireShop(job));
    await runMarkdownPlans(requireShop(job));
  },
  /** Daily price guard (also runs after every plan-runner pass). */
  "price-guard": async (job) => {
    await guardPrices(requireShop(job));
  },
  /** Live sync after product/inventory webhooks. */
  "sync-product": runSyncProduct,
  "sync-inventory": runSyncInventory,
};

/** Jobs enqueued once per shop per night, at `hour`:00 in the store's timezone. */
export const nightlyJobs: { type: string; hour: number }[] = [
  // Catalog refresh + yesterday's closing stock + re-score (as close to midnight as possible).
  { type: "daily-metrics", hour: 0 },
  // Re-subscribe (repairs subscriptions Shopify removed, or a changed app URL), then fill gaps.
  { type: "register-webhooks", hour: 3 },
  { type: "orders-catchup", hour: 4 },
  { type: "price-guard", hour: 6 },
];

/** Jobs enqueued once per shop every hour. */
export const hourlyJobs: string[] = ["rescue-runner"];
