import { getOfflineSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { localDateKey } from "@/lib/jobs/schedule";
import { dueStep, guardWrites, LADDER, liveStock, proposeLadder, restoreWrites, safeToWrite, settleWrites, stepWrites, stockCleared, withOutcomes } from "@/lib/markdown";
import { readLiveVariants, writeVariantPrices } from "@/lib/markdown-shopify";

export class MarkdownError extends Error {
  status;

  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const DAY_MS = 86_400_000;
const message = (e) => (e instanceof Error ? e.message : String(e)).slice(0, 500);
/** After this many hourly runs in a row where Shopify refused a step, the plan pauses. */
const MAX_FAILURES = 3;

function loadPlan(planId) {
  return db().markdownPlan.findUnique({ where: { id: planId }, include: { product: { include: { shop: true } } } });
}

async function shopSettings(shopId) {
  const s = await db().settings.findUnique({ where: { shopId } });
  return {
    marginFloorPct: s ? Number(s.marginFloorPct) : 10,
    maxDiscountPct: s ? Number(s.maxDiscountPct) : 40,
    endAction: s?.markdownEndAction === "hold" ? "hold" : "restore",
  };
}

async function notify(shopId, productId, type) {
  await db().notification.create({ data: { shopId, productId, type } }).catch(() => {});
}

/**
 * Runs `fn` while holding a database lock for the plan's product, so the runner, the guard, a cancel
 * and a new plan can't interleave their read-live-then-write steps on the same product.
 */
async function withPlanLock(planId, fn) {
  const { productId } = await db().markdownPlan.findUniqueOrThrow({ where: { id: planId }, select: { productId: true } });
  return db().$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`markdown:product:${productId}`}))`;
      return fn();
    },
    { timeout: 180_000, maxWait: 30_000 },
  );
}

/**
 * Writes prices safely. Each change is first logged as pending in price_changes — the database
 * refuses a markdown below its floor — then written to Shopify. If Shopify errors (or the answer is
 * lost), live prices are read again: what actually changed is logged as applied, the rest as failed;
 * if that read fails too, the rows stay pending and the next run settles them (`liveState`).
 * Returns what the app has written after this (`applied`), each write's outcome, and the error if any.
 */
async function writePrices(session, plan, live, writes, applied) {
  if (writes.length === 0) return { applied, outcomes: [], error: null };
  for (const w of writes) {
    if (w.reason !== "restore" && !safeToWrite(w.price, w.floor)) {
      throw new MarkdownError(`Refused: ${w.price} is below the floor ${w.floor}`, 409);
    }
  }
  const byId = new Map(live.map((l) => [l.id, l]));
  const local = await db().variant.findMany({ where: { productId: plan.productId }, select: { id: true, shopifyGid: true } });
  const localId = new Map(local.map((v) => [v.shopifyGid, v.id]));
  const rows = await db().$transaction(
    writes.map((w) =>
      db().priceChange.create({
        data: {
          productId: plan.productId,
          variantId: localId.get(w.id) ?? null,
          variantGid: w.id,
          oldPrice: byId.get(w.id).price,
          newPrice: w.price,
          oldCompareAt: byId.get(w.id).compareAtPrice,
          newCompareAt: w.compareAtPrice,
          floorPrice: w.floor,
          reason: w.reason,
          planId: plan.id,
          status: "pending",
        },
      }),
    ),
  );
  let outcomes;
  let error = null;
  try {
    await writeVariantPrices(session, plan.product.shopifyGid, writes.map((w) => ({ id: w.id, price: w.price, compareAtPrice: w.compareAtPrice })));
    outcomes = writes.map(() => "applied");
  } catch (e) {
    error = e;
    outcomes = settleWrites(writes, await readLiveVariants(session, plan.product.shopifyGid).catch(() => null));
  }
  await markRows(rows.map((r) => r.id), outcomes, error ? message(error) : null);
  return { applied: withOutcomes(applied, writes, outcomes), outcomes, error };
}

async function markRows(ids, outcomes, error) {
  const of = (o) => ids.filter((_, i) => outcomes[i] === o);
  await db().priceChange.updateMany({ where: { id: { in: of("applied") } }, data: { status: "applied" } });
  await db().priceChange.updateMany({ where: { id: { in: of("failed") } }, data: { status: "failed", error } });
}

/**
 * Live variants, with writes left pending by an earlier run (crash, or an unknown outcome) settled
 * against them first, so `applied` matches what Shopify shows. Null if the product is gone.
 */
async function liveState(session, plan) {
  const live = await readLiveVariants(session, plan.product.shopifyGid);
  if (!live) return null;
  const data = plan.steps;
  const rows = await db().priceChange.findMany({ where: { planId: plan.id, status: "pending" }, orderBy: { changedAt: "asc" } });
  if (rows.length === 0) return { live, data };
  const writes = rows.map((r) => ({
    id: r.variantGid ?? "",
    price: Number(r.newPrice),
    compareAtPrice: r.newCompareAt == null ? null : Number(r.newCompareAt),
    floor: r.floorPrice == null ? null : Number(r.floorPrice),
    reason: r.reason,
  }));
  const outcomes = settleWrites(writes, live);
  await markRows(rows.map((r) => r.id), outcomes, "Shopify didn't confirm the change and the price wasn't updated");
  return { live, data: { ...data, applied: withOutcomes(data.applied, writes, outcomes) } };
}

async function saveData(planId, data, extra = {}) {
  await db().markdownPlan.update({ where: { id: planId }, data: { steps: data, ...extra } });
}

/**
 * Moves an active plan to `step` (idempotent: variants already at the target are just recorded).
 * Returns null when the plan didn't run (not active, product gone, or paused because of a manual change).
 */
async function applyStep(planId, step) {
  return withPlanLock(planId, async () => {
    const plan = await loadPlan(planId);
    if (!plan || plan.status !== "active") return null;
    const session = await getOfflineSession(plan.product.shop.domain);
    const state = await liveState(session, plan);
    if (!state) {
      await db().markdownPlan.update({ where: { id: plan.id }, data: { status: "cancelled", endReason: "Product deleted in Shopify", endedAt: new Date() } });
      return null;
    }
    const { live, data } = state;
    const settings = await shopSettings(plan.product.shopId);
    const r = stepWrites(data.variants, live, data.applied, step, { ...settings, approvedMaxDiscountPct: Number(plan.maxDiscountPct) });

    if (r.cantDiscount.some((id) => !data.floorAlerted?.includes(id))) {
      data.floorAlerted = [...new Set([...(data.floorAlerted ?? []), ...r.cantDiscount])];
      await notify(plan.product.shopId, plan.productId, "markdown_floor_reached");
    }
    if (r.changedByMerchant.length) {
      await saveData(plan.id, { ...data, applied: { ...data.applied, ...r.alreadyApplied } }, { status: "paused", endReason: "A price was changed in Shopify" });
      await notify(plan.product.shopId, plan.productId, "markdown_paused");
      return null;
    }

    const { applied, outcomes, error } = await writePrices(session, plan, live, r.writes, { ...data.applied, ...r.alreadyApplied });
    const allDone = outcomes.every((o) => o === "applied");
    if (allDone) {
      await saveData(plan.id, { ...data, applied, failures: 0 }, { currentStep: step });
    } else {
      // Partly applied: kept as applied; the next run settles unknown outcomes and retries the rest.
      // Repeated failures pause the plan.
      const failures = (data.failures ?? 0) + 1;
      await saveData(
        plan.id,
        { ...data, applied, failures },
        failures >= MAX_FAILURES ? { status: "paused", endReason: `Shopify kept refusing the price change: ${message(error)}` } : {},
      );
      if (failures >= MAX_FAILURES) await notify(plan.product.shopId, plan.productId, "markdown_paused");
    }
    return { allDone, anyApplied: Object.keys(applied).length > 0, unknown: outcomes.includes("unknown"), error };
  });
}

/**
 * Ends a plan. With `restore`, original prices come back where the live price is still the one the
 * app wrote. If some can't be restored, the plan stays as it is so the next run (or cancel) retries.
 */
async function endPlan(planId, reason, restore) {
  return withPlanLock(planId, async () => {
    const plan = await loadPlan(planId);
    if (!plan || !["active", "paused", "failed"].includes(plan.status)) return;
    const session = await getOfflineSession(plan.product.shop.domain);
    const state = await liveState(session, plan);
    const data = state?.data ?? (plan.steps);
    if (restore && state) {
      const writes = restoreWrites(data.variants, state.live, data.applied);
      const { applied, outcomes, error } = await writePrices(session, plan, state.live, writes, data.applied);
      if (outcomes.some((o) => o !== "applied")) {
        // Retried every run; after repeated failures the plan pauses (no more steps) and the merchant is told.
        const restoreFailures = (data.restoreFailures ?? 0) + 1;
        const giveUp = restoreFailures === MAX_FAILURES;
        await saveData(
          plan.id,
          { ...data, applied, restoreFailures, restoreFailedAt: new Date().toISOString() },
          giveUp && plan.status === "active" ? { status: "paused", endReason: `Shopify kept refusing to restore the original prices: ${message(error)}` } : {},
        );
        if (giveUp) await notify(plan.product.shopId, plan.productId, "markdown_restore_failed");
        throw new MarkdownError(`Some prices couldn't be restored: ${message(error)}`, 502);
      }
      data.applied = {};
    }
    await saveData(plan.id, data, {
      status: reason === "cancelled" ? "cancelled" : "completed",
      endReason: reason,
      endedAt: new Date(),
    });
  });
}

/** Why a product qualifies for a markdown now, or null. */
async function eligibility(productId) {
  const [rescue, score] = await Promise.all([
    db().rescuePlan.findFirst({ where: { productId }, orderBy: { startedAt: "desc" } }),
    db().productScore.findFirst({ where: { productId }, orderBy: { computedAt: "desc" }, select: { status: true } }),
  ]);
  if (rescue?.verdict === "no_change") return { reason: "The rescue plan ended with no change.", rescueId: rescue.id };
  if (score?.status === "dead_stock") return { reason: "Dead stock: no sale for a long time.", rescueId: null };
  return null;
}

async function context(shopId, productId) {
  const product = await db().product.findFirst({ where: { id: productId, shopId }, include: { shop: true } });
  if (!product) throw new MarkdownError("Product not found", 404);
  return { product, session: await getOfflineSession(product.shop.domain), settings: await shopSettings(shopId) };
}

/**
 * The running plan (at most one per product), else the most recently ended one. Plans start at local
 * midnight, so `startedAt` alone can tie between plans of the same day.
 */
async function latestPlan(productId) {
  return (
    (await db().markdownPlan.findFirst({ where: { productId, status: { in: ["active", "paused"] } } })) ??
    db().markdownPlan.findFirst({ where: { productId }, orderBy: [{ startedAt: "desc" }, { endedAt: { sort: "desc", nulls: "last" } }] })
  );
}

/** Markdown state for the product page: the latest plan, eligibility and a live preview. */
export async function markdownOverview(shopId, productId) {
  const { product, session, settings } = await context(shopId, productId);
  const [plan, eligible, priceChanges] = await Promise.all([
    latestPlan(productId),
    eligibility(productId),
    db().priceChange.findMany({ where: { productId }, orderBy: { changedAt: "desc" }, take: 30 }),
  ]);
  const running = plan && ["active", "paused"].includes(plan.status);
  let preview = null;
  if (!running && eligible) {
    const live = await readLiveVariants(session, product.shopifyGid);
    if (live) preview = { proposal: proposeLadder(live, settings), settings, stock: liveStock(live) };
  }
  return { plan, eligible: eligible?.reason ?? null, preview, ladder: LADDER, priceChanges, today: localDateKey(new Date(), product.shop.timezone) };
}

const isProposal = (v) =>
  !!v && typeof v === "object" && Array.isArray((v).variants) &&
  (v).variants.every((x) => x && typeof x.id === "string" && Array.isArray(x.stepPrices));

/** Merchant approves the previewed ladder: the plan starts and step 1 goes live now. */
export async function approveMarkdown(shopId, productId, expected) {
  if (!isProposal(expected)) throw new MarkdownError("Approve the previewed schedule", 400);
  const { product, settings, session } = await context(shopId, productId);
  const eligible = await eligibility(productId);
  if (!eligible) throw new MarkdownError("This product doesn't qualify for a markdown right now.", 400);
  const live = await readLiveVariants(session, product.shopifyGid);
  if (!live) throw new MarkdownError("Product no longer exists in Shopify", 404);
  const startStock = liveStock(live);
  if (startStock <= 0) throw new MarkdownError("No stock to clear (or inventory isn't tracked), so there's nothing to mark down.", 400);
  const proposal = proposeLadder(live, settings);
  if (proposal.variants.length === 0) throw new MarkdownError("No variant can be discounted within your margin floor.", 400);
  const prices = (p) => JSON.stringify(p.variants.map((v) => [v.id, v.stepPrices]));
  if (prices(expected) !== prices(proposal)) {
    throw new MarkdownError("Prices or costs changed since the preview. Review the new schedule and approve again.", 409);
  }

  let plan;
  try {
    plan = await db().markdownPlan.create({
      data: {
        productId,
        rescuePlanId: eligible.rescueId,
        steps: { variants: proposal.variants, applied: {}, failures: 0 },
        floorPrice: Math.min(...proposal.variants.map((v) => v.floor)),
        maxDiscountPct: settings.maxDiscountPct,
        status: "active",
        startStock,
        endAction: settings.endAction,
        startedAt: new Date(`${localDateKey(new Date(), product.shop.timezone)}T00:00:00Z`),
      },
    });
  } catch (error) {
    if ((error).code === "P2002") throw new MarkdownError("A markdown plan is already running for this product.", 409);
    throw error;
  }
  // Step 1 goes live now. If nothing reached Shopify (and nothing is pending), the plan fails and the
  // merchant sees why; if some prices did (or might have), it stays active and the runner settles and
  // retries the rest within the hour.
  let result;
  try {
    result = await applyStep(plan.id, 0);
  } catch (error) {
    const [current, pending] = await Promise.all([loadPlan(plan.id), db().priceChange.count({ where: { planId: plan.id, status: "pending" } })]);
    const nothingApplied = pending === 0 && Object.keys((current?.steps)?.applied ?? {}).length === 0;
    if (nothingApplied) {
      await db().markdownPlan.update({ where: { id: plan.id }, data: { status: "failed", endReason: message(error), endedAt: new Date() } });
    }
    throw error instanceof MarkdownError ? error : new MarkdownError(message(error), 502);
  }
  let notice = null;
  if (result && !result.allDone) {
    if (!result.anyApplied && !result.unknown) {
      await db().markdownPlan.update({ where: { id: plan.id }, data: { status: "failed", endReason: message(result.error), endedAt: new Date() } });
      throw new MarkdownError(`Shopify refused the price change: ${message(result.error)}`, 502);
    }
    notice = result.unknown
      ? "Shopify didn't confirm every price; the app checks again within the hour."
      : `Some prices weren't changed (${message(result.error)}); the app retries within the hour.`;
  }
  return { ...(await db().markdownPlan.findUniqueOrThrow({ where: { id: plan.id } })), notice };
}

/** Merchant cancels: original prices come back (where they are still the app's). */
export async function cancelMarkdown(shopId, planId) {
  const plan = await db().markdownPlan.findFirst({ where: { id: planId, product: { shopId }, status: { in: ["active", "paused", "failed"] } } });
  if (!plan) throw new MarkdownError("No running plan", 404);
  await endPlan(plan.id, "cancelled", true);
}

/**
 * Part of the hourly plan runner. Active and paused plans end (restoring or holding prices) when half
 * the starting stock has sold or the ladder is done; active plans move to the next step every 14 days.
 */
export async function runMarkdownPlans(shopId) {
  const plans = await db().markdownPlan.findMany({
    where: { status: { in: ["active", "paused"] }, product: { shopId } },
    include: { product: { include: { shop: true } } },
  });
  for (const plan of plans) {
    try {
      const session = await getOfflineSession(plan.product.shop.domain);
      const live = await readLiveVariants(session, plan.product.shopifyGid);
      if (!live) {
        await db().markdownPlan.update({ where: { id: plan.id }, data: { status: "cancelled", endReason: "Product deleted in Shopify", endedAt: new Date() } });
        continue;
      }
      // After repeated refused restores, the runner retries once a day (cancel still tries right away).
      const data = plan.steps;
      const retryLater = (data.restoreFailures ?? 0) >= MAX_FAILURES && Date.now() - Date.parse(data.restoreFailedAt ?? "") < DAY_MS;
      if (stockCleared(plan.startStock, liveStock(live))) {
        if (retryLater) continue;
        await endPlan(plan.id, "stock_cleared", plan.endAction !== "hold");
        continue;
      }
      const today = Date.parse(`${localDateKey(new Date(), plan.product.shop.timezone)}T00:00:00Z`);
      const step = dueStep(Math.floor((today - plan.startedAt.getTime()) / DAY_MS));
      if (step == null) {
        if (retryLater) continue;
        // Ladder done and still unsold: bundle / Outlet (v2) or consider delisting.
        await endPlan(plan.id, "ladder_finished", plan.endAction !== "hold");
        await notify(shopId, plan.productId, "markdown_unsold");
      } else if (plan.status === "active" && step > plan.currentStep) {
        await applyStep(plan.id, step);
      }
    } catch (error) {
      console.error("[markdown] plan", plan.id, error);
    }
  }
}

/**
 * Price guard (after every runner pass and daily): live prices must be at or above the current floor
 * (from the live cost). The app's own prices on active plans — and, with `held` (daily), prices kept
 * by a finished "hold" plan — are raised to it (never above the original); prices set by hand and
 * paused plans are only reported, once per variant until it's fixed.
 */
export async function guardPrices(shopId, opts = {}) {
  const plans = await db().markdownPlan.findMany({
    where: {
      product: { shopId },
      OR: [{ status: { in: ["active", "paused"] } }, ...(opts.held ? [{ status: "completed", endAction: "hold" }] : [])],
    },
    orderBy: [{ startedAt: "desc" }, { endedAt: { sort: "desc", nulls: "first" } }],
    select: { id: true, productId: true, status: true },
  });
  // One plan per product: the running one, else the newest held one (its price is a newer plan's original).
  const running = new Set(plans.filter((p) => p.status !== "completed").map((p) => p.productId));
  const candidates = plans.filter((p) => p.status !== "completed" || !running.has(p.productId));
  const latest = candidates.filter((p, i) => candidates.findIndex((q) => q.productId === p.productId) === i);
  const settings = await shopSettings(shopId);
  for (const { id } of latest) {
    try {
      await withPlanLock(id, async () => {
        const plan = await loadPlan(id);
        if (!plan) return;
        const held = plan.status === "completed" && plan.endAction === "hold";
        if (!held && !["active", "paused"].includes(plan.status)) return;
        if (held && Object.keys((plan.steps).applied).length === 0) return;
        const session = await getOfflineSession(plan.product.shop.domain);
        const state = await liveState(session, plan);
        if (!state) return;
        const { live, data } = state;
        const r = guardWrites(data.variants, live, data.applied, { marginFloorPct: settings.marginFloorPct, paused: plan.status === "paused" });
        const { applied, outcomes } = await writePrices(session, plan, live, r.writes, data.applied);
        const fresh = r.alerts.filter((v) => !data.guardAlerted?.includes(v));
        if (fresh.length || outcomes.includes("applied")) await notify(shopId, plan.productId, "price_guard");
        const next = { ...data, applied, guardAlerted: r.alerts };
        if (JSON.stringify(next) !== JSON.stringify(plan.steps)) await saveData(plan.id, next);
      });
    } catch (error) {
      console.error("[markdown] guard", id, error);
    }
  }
}
