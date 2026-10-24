import type { Session } from "@shopify/shopify-api";
import { getOfflineSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { localDateKey } from "@/lib/jobs/schedule";
import { dueStep, floorPrice, LADDER, proposeLadder, safeToWrite, stockCleared, type LadderProposal, type VariantPlan } from "@/lib/markdown";
import { readLiveVariants, writeVariantPrices, type LiveVariant } from "@/lib/markdown-shopify";

export class MarkdownError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const DAY_MS = 86_400_000;
const cents = (n: number) => Math.round(n * 100);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

async function context(shopId: string, productId: string) {
  const product = await db().product.findFirst({ where: { id: productId, shopId }, include: { shop: true } });
  if (!product) throw new MarkdownError("Product not found", 404);
  const settings = await db().settings.findUnique({ where: { shopId } });
  return {
    product,
    session: await getOfflineSession(product.shop.domain),
    settings: {
      marginFloorPct: settings ? Number(settings.marginFloorPct) : 10,
      maxDiscountPct: settings ? Number(settings.maxDiscountPct) : 40,
      endAction: settings?.markdownEndAction === "hold" ? "hold" : "restore",
    },
  };
}

/** Preview of the ladder from live prices and costs (shown before approval). */
export async function previewMarkdown(shopId: string, productId: string) {
  const { product, session, settings } = await context(shopId, productId);
  const live = await readLiveVariants(session, product.shopifyGid);
  if (!live) throw new MarkdownError("Product no longer exists in Shopify", 404);
  return { proposal: proposeLadder(live, settings), settings, stock: live.reduce((s, v) => s + Math.max(0, v.inventory), 0) };
}

/**
 * Writes one set of prices safely: every change is first logged in price_changes (the database
 * refuses a markdown below its floor), then written to Shopify, then marked applied or failed.
 */
async function writePrices(
  session: Session,
  product: { id: string; shopifyGid: string },
  planId: string,
  reason: "markdown" | "restore" | "guard_revert",
  changes: { variant: LiveVariant; price: number; compareAtPrice: number | null; floor: number | null }[],
) {
  if (changes.length === 0) return;
  for (const c of changes) {
    if (reason !== "restore" && !safeToWrite(c.price, c.floor)) {
      throw new MarkdownError(`Refused: ${c.price} for "${c.variant.title}" is below its floor ${c.floor}`, 409);
    }
  }
  const local = await db().variant.findMany({ where: { productId: product.id }, select: { id: true, shopifyGid: true } });
  const localId = new Map(local.map((v) => [v.shopifyGid, v.id]));
  const rows = await db().$transaction(
    changes.map((c) =>
      db().priceChange.create({
        data: {
          productId: product.id,
          variantId: localId.get(c.variant.id) ?? null,
          variantGid: c.variant.id,
          oldPrice: c.variant.price,
          newPrice: c.price,
          oldCompareAt: c.variant.compareAtPrice,
          newCompareAt: c.compareAtPrice,
          floorPrice: c.floor,
          reason,
          planId,
          status: "pending",
        },
      }),
    ),
  );
  try {
    await writeVariantPrices(session, product.shopifyGid, changes.map((c) => ({ id: c.variant.id, price: c.price, compareAtPrice: c.compareAtPrice })));
    await db().priceChange.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { status: "applied" } });
  } catch (error) {
    await db().priceChange.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { status: "failed", error: message(error) } });
    throw error;
  }
}

type PlanSteps = { variants: VariantPlan[] };

/** The price a variant should have at `step` (-1 = original). */
const expectedPrice = (v: VariantPlan, step: number) => (step < 0 ? v.originalPrice : v.stepPrices[step]);

/**
 * Moves a plan to `step`. Live prices must still be what the plan last set (otherwise someone changed
 * them in Shopify: the plan is paused, not overwritten). The floor is re-checked against the live cost.
 */
async function applyStep(planId: string, step: number) {
  const plan = await db().markdownPlan.findUniqueOrThrow({ where: { id: planId }, include: { product: { include: { shop: true } } } });
  const settings = await db().settings.findUnique({ where: { shopId: plan.product.shopId } });
  const margin = settings ? Number(settings.marginFloorPct) : 10;
  const session = await getOfflineSession(plan.product.shop.domain);
  const live = await readLiveVariants(session, plan.product.shopifyGid);
  if (!live) return endPlan(plan.id, "cancelled", { restore: false, note: "Product deleted in Shopify" });
  const byId = new Map(live.map((v) => [v.id, v]));
  const { variants } = plan.steps as PlanSteps;

  const changes = [];
  for (const v of variants) {
    const lv = byId.get(v.id);
    if (!lv) continue; // variant deleted
    if (cents(lv.price) !== cents(expectedPrice(v, plan.currentStep))) {
      await db().markdownPlan.update({ where: { id: plan.id }, data: { status: "paused", endReason: `Price of "${v.title}" was changed in Shopify` } });
      await notify(plan.product.shopId, plan.productId, "markdown_paused");
      return;
    }
    const liveFloor = floorPrice(lv.cost, margin);
    const floor = Math.max(v.floor, liveFloor ?? v.floor);
    const price = Math.max(expectedPrice(v, step), floor);
    if (cents(price) === cents(lv.price)) continue;
    changes.push({ variant: lv, price, compareAtPrice: v.compareAt, floor });
  }
  await writePrices(session, plan.product, plan.id, "markdown", changes);
  await db().markdownPlan.update({ where: { id: plan.id }, data: { currentStep: step } });
}

/** Ends a plan; restores original prices (where they are still the plan's) unless holding. */
async function endPlan(planId: string, reason: "stock_cleared" | "ladder_finished" | "cancelled", opts: { restore: boolean; note?: string }) {
  const plan = await db().markdownPlan.findUniqueOrThrow({ where: { id: planId }, include: { product: { include: { shop: true } } } });
  if (opts.restore) {
    const session = await getOfflineSession(plan.product.shop.domain);
    const live = (await readLiveVariants(session, plan.product.shopifyGid)) ?? [];
    const byId = new Map(live.map((v) => [v.id, v]));
    const changes = (plan.steps as PlanSteps).variants.flatMap((v) => {
      const lv = byId.get(v.id);
      // Only undo our own price: if the merchant changed it since, theirs stays.
      if (!lv || cents(lv.price) !== cents(expectedPrice(v, plan.currentStep))) return [];
      return [{ variant: lv, price: v.originalPrice, compareAtPrice: v.originalCompareAt, floor: null }];
    });
    await writePrices(session, plan.product, plan.id, "restore", changes);
  }
  await db().markdownPlan.update({
    where: { id: plan.id },
    data: { status: reason === "cancelled" ? "cancelled" : "completed", endReason: opts.note ?? reason, endedAt: new Date() },
  });
}

async function notify(shopId: string, productId: string, type: string) {
  await db().notification.create({ data: { shopId, productId, type } }).catch(() => {});
}

/** Merchant approves the previewed ladder: the plan starts and step 1 goes live now. */
export async function approveMarkdown(shopId: string, productId: string, expected: LadderProposal | null) {
  const { product, settings, session } = await context(shopId, productId);
  const live = await readLiveVariants(session, product.shopifyGid);
  if (!live) throw new MarkdownError("Product no longer exists in Shopify", 404);
  const proposal = proposeLadder(live, settings);
  if (proposal.variants.length === 0) throw new MarkdownError("No variant can be discounted within your margin floor.", 400);
  // The merchant approved specific prices: refuse if they changed since the preview.
  const prices = (p: LadderProposal) => JSON.stringify(p.variants.map((v) => [v.id, v.stepPrices]));
  if (expected && prices(expected) !== prices(proposal)) {
    throw new MarkdownError("Prices or costs changed since the preview. Review the new schedule and approve again.", 409);
  }
  const rescue = await db().rescuePlan.findFirst({ where: { productId, verdict: { not: null } }, orderBy: { startedAt: "desc" } });
  let plan;
  try {
    plan = await db().markdownPlan.create({
      data: {
        productId,
        rescuePlanId: rescue?.id ?? null,
        steps: { variants: proposal.variants } satisfies PlanSteps,
        floorPrice: Math.min(...proposal.variants.map((v) => v.floor)),
        maxDiscountPct: settings.maxDiscountPct,
        status: "active",
        startStock: live.reduce((s, v) => s + Math.max(0, v.inventory), 0),
        endAction: settings.endAction,
        startedAt: new Date(`${localDateKey(new Date(), product.shop.timezone)}T00:00:00Z`),
      },
    });
  } catch {
    throw new MarkdownError("A markdown plan is already running for this product.", 409);
  }
  try {
    await applyStep(plan.id, 0);
  } catch (error) {
    await db().markdownPlan.update({ where: { id: plan.id }, data: { status: "failed", endReason: message(error), endedAt: new Date() } });
    throw error instanceof MarkdownError ? error : new MarkdownError(message(error), 502);
  }
  return db().markdownPlan.findUniqueOrThrow({ where: { id: plan.id } });
}

/** Merchant cancels: original prices come back (where they are still the plan's). */
export async function cancelMarkdown(shopId: string, planId: string) {
  const plan = await db().markdownPlan.findFirst({ where: { id: planId, product: { shopId }, status: { in: ["active", "paused"] } } });
  if (!plan) throw new MarkdownError("No running plan", 404);
  await endPlan(plan.id, "cancelled", { restore: true });
}

/**
 * Part of the hourly plan runner: stops plans whose stock is half sold or whose ladder is done, and
 * moves plans to their next step every 14 days.
 */
export async function runMarkdownPlans(shopId: string) {
  const plans = await db().markdownPlan.findMany({
    where: { status: "active", product: { shopId } },
    include: { product: { include: { shop: true, variants: { select: { inventoryQty: true } } } } },
  });
  for (const plan of plans) {
    try {
      const stock = plan.product.variants.reduce((s, v) => s + Math.max(0, v.inventoryQty), 0);
      if (stockCleared(plan.startStock, stock)) {
        await endPlan(plan.id, "stock_cleared", { restore: plan.endAction !== "hold" });
        continue;
      }
      const today = Date.parse(`${localDateKey(new Date(), plan.product.shop.timezone)}T00:00:00Z`);
      const days = Math.floor((today - plan.startedAt!.getTime()) / DAY_MS);
      const step = dueStep(days);
      if (step == null) {
        // Ladder done and still unsold: bundle / Outlet (v2) or consider delisting.
        await endPlan(plan.id, "ladder_finished", { restore: plan.endAction !== "hold" });
        await notify(shopId, plan.productId, "markdown_unsold");
      } else if (step > plan.currentStep) {
        await applyStep(plan.id, step);
      }
    } catch (error) {
      console.error("[markdown] plan", plan.id, error);
    }
  }
  await guardPrices(shopId);
}

/**
 * Price guard (after the runner and nightly): every running plan's live prices must be at or above
 * their floor. A price below it is put back to the plan's price for the current step (logged) and the
 * merchant is notified.
 */
export async function guardPrices(shopId: string) {
  const plans = await db().markdownPlan.findMany({
    where: { status: { in: ["active", "paused"] }, product: { shopId } },
    include: { product: { include: { shop: true } } },
  });
  for (const plan of plans) {
    const session = await getOfflineSession(plan.product.shop.domain);
    const live = await readLiveVariants(session, plan.product.shopifyGid);
    if (!live) continue;
    const byId = new Map(live.map((v) => [v.id, v]));
    const fixes = (plan.steps as PlanSteps).variants.flatMap((v) => {
      const lv = byId.get(v.id);
      if (!lv || safeToWrite(lv.price, v.floor)) return [];
      return [{ variant: lv, price: Math.max(expectedPrice(v, plan.currentStep), v.floor), compareAtPrice: v.compareAt, floor: v.floor }];
    });
    if (fixes.length) {
      await writePrices(session, plan.product, plan.id, "guard_revert", fixes);
      await notify(shopId, plan.productId, "price_guard");
    }
  }
}

export { LADDER };
