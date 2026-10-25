import { PermanentJobError } from "@/lib/jobs/errors";
import { guardPrices, runMarkdownPlans } from "@/lib/markdown-engine";
import { runRescuePlans } from "@/lib/rescue-plans";
import { closeMonth } from "@/lib/reports";
import { scoreShop } from "@/lib/score-shop";
import { runDailyMetrics, runInitialSync, runOrdersCatchup, runRegisterWebhooks, runSyncPoll } from "@/lib/sync/initial-sync";
import { runSyncInventory, runSyncProduct } from "@/lib/sync/live";
import { syncViews } from "@/lib/sync/views";

function requireShop(job) {
  if (!job.shopId) throw new PermanentJobError(`${job.type} needs a shop`);
  return job.shopId;
}

/**
 * Job type → handler `(job, signal) => Promise<void>`. Feature tasks register their handlers here.
 * A handler must be idempotent (a job can run again after a crash or timeout) and should stop when
 * `signal` aborts (timeout or shutdown). Throw `PermanentJobError` when retrying can't help.
 */
export const handlers = {
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
  /** Product views from ShopifyQL (90 days the first time, then the last 7), then a re-score. */
  "views-sync": async (job, signal) => {
    requireShop(job);
    await syncViews(job, signal);
  },
  /** Plan runner: closes measurement windows, applies markdown steps, restores prices, guards floors. */
  "rescue-runner": async (job) => {
    // Each part runs even if another fails; the job fails afterwards so it is retried.
    const shopId = requireShop(job);
    const results = await Promise.allSettled([
      runRescuePlans(shopId),
      runMarkdownPlans(shopId).then(() => guardPrices(shopId)),
    ]);
    const failed = results.find((r) => r.status === "rejected");
    if (failed) throw (failed).reason;
  },
  /** Daily price guard (also runs after every plan-runner pass). */
  "price-guard": async (job) => {
    await guardPrices(requireShop(job), { held: true });
  },
  "monthly-report": async (job) => {
    await closeMonth(requireShop(job));
  },
  /** Live sync after product/inventory webhooks. */
  "sync-product": runSyncProduct,
  "sync-inventory": runSyncInventory,
};

/** Jobs enqueued once per shop per night, at `hour`:00 in the store's timezone. */
export const nightlyJobs = [
  // Catalog refresh + yesterday's closing stock + re-score (as close to midnight as possible).
  { type: "daily-metrics", hour: 0 },
  // Re-subscribe (repairs subscriptions Shopify removed, or a changed app URL), then fill gaps.
  { type: "register-webhooks", hour: 3 },
  { type: "orders-catchup", hour: 4 },
  { type: "price-guard", hour: 6 },
  // Stores last month's report once it is over (no-op on other days).
  { type: "monthly-report", hour: 6 },
];

/** Jobs enqueued once per shop every hour. */
export const hourlyJobs = ["rescue-runner"];
