import { runAbTests } from "@/lib/ab-tests-shopify";
import { pruneDrafts } from "@/lib/ai/photos";
import { refreshShopLinks } from "@/lib/competitor-prices";
import { syncBenchmarks } from "@/lib/google-merchant";
import { PermanentJobError } from "@/lib/jobs/errors";
import { enqueue } from "@/lib/jobs/queue";
import { guardPrices, runMarkdownPlans } from "@/lib/markdown-engine";
import { runPageBuilder } from "@/lib/page-builder-shopify";
import { runRescuePlans } from "@/lib/rescue-plans";
import { closeMonth } from "@/lib/reports";
import { scoreShop } from "@/lib/score-shop";
import { runDailyMetrics, runInitialSync, runOrdersCatchup, runRegisterWebhooks, runSyncPoll } from "@/lib/sync/initial-sync";
import { runSyncInventory, runSyncProduct } from "@/lib/sync/live";
import { runReturnsSync } from "@/lib/sync/returns";
import { syncViews } from "@/lib/sync/views";
import { sendWeeklyPlan } from "@/lib/weekly-plans";

/** Follow-up runs per night for shops with many competitor links (each run reads for up to 3 minutes). */
const MAX_PRICE_ROUNDS = 20;

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
  /** Refunds per order line and return reasons (orders with refunds or returns only). */
  "returns-sync": runReturnsSync,
  "daily-metrics": runDailyMetrics,
  /** Product views from ShopifyQL (90 days the first time, then the last 7), then a re-score. */
  "views-sync": async (job, signal) => {
    requireShop(job);
    await syncViews(job, signal);
  },
  /**
   * Plan runner: closes measurement windows, applies markdown steps, restores prices, guards floors,
   * and ends A/B tests that are decided.
   */
  "rescue-runner": async (job) => {
    // Each part runs even if another fails; the job fails afterwards so it is retried.
    const shopId = requireShop(job);
    const results = await Promise.allSettled([
      runRescuePlans(shopId),
      runMarkdownPlans(shopId).then(() => guardPrices(shopId)),
      runAbTests(shopId),
    ]);
    const failed = results.find((r) => r.status === "rejected");
    if (failed) throw failed.reason;
  },
  /** Daily price guard (also runs after every plan-runner pass). */
  "price-guard": async (job) => {
    await guardPrices(requireShop(job), { held: true });
  },
  "monthly-report": async (job) => {
    await closeMonth(requireShop(job));
  },
  /**
   * Reads the price on every competitor link (market price), a few minutes per run. Links still waiting
   * go to a follow-up run at the back of the queue, so other shops' jobs aren't held up.
   */
  "competitor-prices": async (job, signal) => {
    const shopId = requireShop(job);
    const { remaining } = await refreshShopLinks(shopId, signal);
    const round = Number(job.payload?.round ?? 0);
    if (remaining > 0 && !signal?.aborted && round < MAX_PRICE_ROUNDS) {
      await enqueue({ type: "competitor-prices", shopId, payload: { round: round + 1 }, uniqueKey: `competitor-prices:more:${job.id}` });
    }
  },
  /** Google's price benchmarks from the shop's Merchant Center (when connected). */
  "google-benchmarks": async (job, signal) => {
    await syncBenchmarks(requireShop(job), signal);
  },
  /** Mondays: this week's plan in the inbox (a no-op on other days). */
  "weekly-plan": async (job) => {
    await sendWeeklyPlan(requireShop(job));
  },
  /** AI photos the merchant didn't add within a day are removed with their image. */
  "ai-photo-drafts": async (job) => {
    await pruneDrafts(requireShop(job));
  },
  /** Publishes the page builder for the shop's plan and refreshes "often bought together". */
  "page-builder": async (job, signal) => {
    await runPageBuilder(requireShop(job), signal);
  },
  /** A/B tests: ends decided ones and those the plan no longer includes (also hourly, with the plan runner). */
  "ab-tests": async (job) => {
    await runAbTests(requireShop(job));
  },
  /** Live sync after product/inventory webhooks. */
  "sync-product": runSyncProduct,
  "sync-inventory": runSyncInventory,
};

/** Jobs enqueued once per shop per night, at `hour`:00 in the store's timezone. */
export const nightlyJobs = [
  // Catalog refresh + yesterday's closing stock + re-score (as close to midnight as possible).
  { type: "daily-metrics", hour: 0 },
  { type: "ai-photo-drafts", hour: 2 },
  // Re-subscribe (repairs subscriptions Shopify removed, or a changed app URL), then fill gaps.
  { type: "register-webhooks", hour: 3 },
  { type: "orders-catchup", hour: 4 },
  { type: "returns-sync", hour: 4 },
  { type: "competitor-prices", hour: 5 },
  { type: "google-benchmarks", hour: 5 },
  // After the orders catch-up: "often bought together" from the latest orders.
  { type: "page-builder", hour: 5 },
  { type: "price-guard", hour: 6 },
  // Stores last month's report once it is over (no-op on other days).
  { type: "monthly-report", hour: 6 },
  // After the night's scoring, catch-up and rescue verdicts: this week's plan (Mondays only).
  { type: "weekly-plan", hour: 7 },
];

/** Jobs enqueued once per shop every hour. */
export const hourlyJobs = ["rescue-runner"];
