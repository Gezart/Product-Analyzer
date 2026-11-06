// A/B tests in Shopify and the database: the product's `$app.ab_test` metafield (what the storefront
// shows), visitors and add-to-carts from the storefront, purchases from orders, and when a test ends.

import { countsFrom, decide, isTestId, isVisitorId, KIND_LABELS, KINDS, plausibleVisitors, purchasesFor, storefrontValue, testLinesFromBulk, testStats, validateTest, variantOf, versionView } from "@/lib/ab-tests";
import { adminGraphql } from "@/lib/admin";
import { getOfflineSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { applyFix } from "@/lib/fix-center";
import { readLiveProduct, stateOf } from "@/lib/fix-shopify";
import { sameState } from "@/lib/fixes";
import { errorMessage, HttpError } from "@/lib/http-error";
import { notify } from "@/lib/notify";
import { hasFeature } from "@/lib/plans";

const APP_NAMESPACE = "$app";
const KEY = "ab_test";
/** A test still "starting" after this crashed before it ran. */
const STALE_START_MS = 10 * 60_000;
/** A "Use B now" still "applying" after this crashed (applying a fix takes seconds). */
const STALE_APPLY_MS = 5 * 60_000;
/** Visitors and purchases of a test ended this long ago are removed (its numbers stay in `result`). */
const KEEP_ENDED_MS = 30 * 86_400_000;

const METAFIELD_READ = `#graphql
  query AbTestMetafield($id: ID!) { product(id: $id) { metafield(namespace: "${APP_NAMESPACE}", key: "${KEY}") { value } } }`;

const METAFIELDS_SET = `#graphql
  mutation AbTestSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message } }
  }`;

const METAFIELDS_DELETE = `#graphql
  mutation AbTestDelete($metafields: [MetafieldIdentifierInput!]!) {
    metafieldsDelete(metafields: $metafields) { deletedMetafields { key } userErrors { field message } }
  }`;

const errorsText = (errors) => errors.map((e) => e.message).join("; ");

/** Sets the product's test metafield (version B for the storefront). A refusal is a 502 with Shopify's reason. */
async function publish(session, productGid, test) {
  const data = await adminGraphql(session, METAFIELDS_SET, {
    metafields: [{ ownerId: productGid, namespace: APP_NAMESPACE, key: KEY, type: "json", value: JSON.stringify(storefrontValue(test)) }],
  });
  const errors = data.metafieldsSet.userErrors;
  if (errors.length) throw new HttpError(`Shopify didn't save the test: ${errorsText(errors)}`, 502);
}

/** The test id the product's metafield holds now (null when there is none). */
async function publishedTestId(session, productGid) {
  const data = await adminGraphql(session, METAFIELD_READ, { id: productGid });
  try {
    return JSON.parse(data.product?.metafield?.value ?? "null")?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Removes the test's metafield, so the storefront shows the page as it is again — only while it still
 * holds this test (a newer test on the product keeps its own). Failures are logged and retried hourly.
 * Resolves whether the storefront no longer shows the test.
 */
async function unpublish(session, test, productGid) {
  try {
    if ((await publishedTestId(session, productGid)) === test.id) {
      const data = await adminGraphql(session, METAFIELDS_DELETE, { metafields: [{ ownerId: productGid, namespace: APP_NAMESPACE, key: KEY }] });
      const errors = data.metafieldsDelete.userErrors;
      if (errors.length) throw new Error(errorsText(errors));
    }
    await db().abTest.update({ where: { id: test.id }, data: { published: false } });
    return true;
  } catch (error) {
    console.error("[ab-tests] storefront not cleared yet (retried hourly)", test.id, errorMessage(error));
    return false;
  }
}

/** Both versions' numbers (`testStats`) per test id. */
export async function statsFor(testIds) {
  if (!testIds.length) return new Map();
  const [visitors, purchases] = await Promise.all([
    db().abTestVisitor.groupBy({ by: ["testId", "variant"], where: { testId: { in: testIds } }, _count: { _all: true, cartedAt: true } }),
    db().abTestPurchase.groupBy({ by: ["testId", "variant", "visitorId"], where: { testId: { in: testIds } }, _sum: { quantity: true, revenue: true } }),
  ]);
  const counts = countsFrom(
    visitors.map((g) => ({ testId: g.testId, variant: g.variant, visitors: g._count._all, carts: g._count.cartedAt })),
    purchases.map((g) => ({ testId: g.testId, variant: g.variant, units: g._sum.quantity ?? 0, revenue: Number(g._sum.revenue ?? 0) })),
  );
  return new Map(testIds.map((id) => [id, testStats(counts.get(id))]));
}

async function productOf(shopId, productId) {
  const product = await db().product.findFirst({ where: { id: productId, shopId } });
  if (!product) throw new HttpError("Product not found", 404);
  return product;
}

/** The product as the test form shows it: title, description and photos read live from Shopify. */
export async function productForTest(shop, productId) {
  const product = await productOf(shop.id, productId);
  const live = await readLiveProduct(await getOfflineSession(shop.domain), product.shopifyGid);
  if (!live) throw new HttpError("Product no longer exists in Shopify", 404);
  const running = await db().abTest.findFirst({ where: { productId: product.id, status: { in: ["starting", "running", "applying"] } }, select: { id: true, kind: true } });
  return {
    product: { id: product.id, title: product.title, shopifyGid: product.shopifyGid },
    title: live.title,
    descriptionHtml: live.descriptionHtml,
    media: live.media.map((m) => ({ id: m.id, type: m.type, previewUrl: m.previewUrl, alt: m.alt })),
    running,
  };
}

/**
 * Starts a test: checks version B against the product as it is now (A), stores it, then sets the
 * metafield the storefront reads. `expected` is the A the merchant's page showed: when the product
 * changed since, nothing starts (409). A metafield Shopify refuses leaves nothing behind.
 */
export async function startTest(shop, productId, kind, rawB, expected) {
  const product = await productOf(shop.id, productId);
  const session = await getOfflineSession(shop.domain);
  const live = await readLiveProduct(session, product.shopifyGid);
  if (!live) throw new HttpError("Product no longer exists in Shopify", 404);
  const a = KINDS.includes(kind) ? stateOf(live, kind) : null;
  const check = validateTest(kind, rawB, { a, mediaTypes: live.media.map((m) => m.type) });
  if (!check.ok) throw new HttpError(check.error, 400);
  if (expected !== undefined && !sameState(kind, a, expected)) {
    throw new HttpError("This product changed in Shopify since the page was opened. Reload and try again.", 409);
  }
  const busy = await db().fix.findFirst({
    where: { productId: product.id, status: { in: ["approved", "undoing"] }, createdAt: { gt: new Date(Date.now() - 2 * 60_000) } },
    select: { id: true },
  });
  if (busy) throw new HttpError("A change to this product is still being applied. Try again in a moment.", 409);

  const previews = kind === "images" ? Object.fromEntries(live.media.map((m) => [m.id, m.previewUrl])) : {};
  let test;
  try {
    test = await db().abTest.create({ data: { shopId: shop.id, productId: product.id, kind, a, b: check.b, previews, status: "starting" } });
  } catch (error) {
    if (error?.code === "P2002") throw new HttpError("A test is already running on this product.", 409);
    throw error;
  }
  try {
    await publish(session, product.shopifyGid, test);
  } catch (error) {
    // Shopify may have saved it even so (an answer lost on the way): removed again before the test is.
    // If that fails too, the hourly run cleans it up (a "starting" test older than 10 minutes).
    if (await unpublish(session, test, product.shopifyGid)) await db().abTest.delete({ where: { id: test.id } }).catch(() => {});
    throw error;
  }
  // Older tests whose metafield wasn't removed yet: this one replaced it.
  await db().abTest.updateMany({ where: { productId: product.id, id: { not: test.id }, published: true }, data: { published: false } });
  return db().abTest.update({ where: { id: test.id }, data: { status: "running", published: true, startedAt: new Date() } });
}

/**
 * Ends a running test (the numbers as they are now are kept as its result) and takes it off the
 * storefront. False when it wasn't running any more (ended elsewhere at the same time).
 */
async function endTest(session, test, productGid, { reason, winner = null }) {
  const stats = (await statsFor([test.id])).get(test.id);
  const claimed = await db().abTest.updateMany({
    where: { id: test.id, status: "running" },
    data: { status: "ended", endReason: reason, winner, result: stats, endedAt: new Date() },
  });
  if (!claimed.count) return null;
  await unpublish(session, test, productGid);
  return stats;
}

async function testOf(shopId, testId) {
  const test = await db().abTest.findFirst({ where: { id: testId, shopId }, include: { product: { select: { shopifyGid: true } } } });
  if (!test) throw new HttpError("Test not found", 404);
  return test;
}

/** The merchant stops a running test: everyone sees the page as it is (A) again. */
export async function stopTest(shop, testId) {
  const test = await testOf(shop.id, testId);
  if (test.status !== "running") throw new HttpError("This test isn't running.", 409);
  const session = await getOfflineSession(shop.domain);
  if (!(await endTest(session, test, test.product.shopifyGid, { reason: "stopped" }))) throw new HttpError("This test isn't running.", 409);
}

/**
 * "Use B now": applies version B to the product as a fix (snapshot, Undo and a rescue plan, as in the
 * fix center), then ends the test. When the product changed since the test started, B isn't applied (409).
 */
export async function applyVersionB(shop, testId) {
  const test = await testOf(shop.id, testId);
  if (test.status === "applied" || test.status === "applying") throw new HttpError("B is already in use.", 409);
  if (!["running", "ended"].includes(test.status)) throw new HttpError("This test hasn't started.", 409);
  const wasRunning = test.status === "running";
  const stats = wasRunning ? (await statsFor([test.id])).get(test.id) : null;
  // Claimed: a second click, another tab or the hourly run can't act on it meanwhile (a crash is
  // recovered by the hourly run after STALE_APPLY_MS).
  const claimed = await db().abTest.updateMany({ where: { id: test.id, status: test.status }, data: { status: "applying", claimedAt: new Date() } });
  if (!claimed.count) throw new HttpError("This test changed meanwhile. Reload and try again.", 409);

  const session = await getOfflineSession(shop.domain);
  let fix = null;
  try {
    // The product already shows B (set in Shopify, or an earlier attempt got through): B is in use.
    const live = await readLiveProduct(session, test.product.shopifyGid);
    if (!live || !sameState(test.kind, stateOf(live, test.kind), test.b)) {
      fix = await applyFix(shop.id, test.productId, test.kind, test.b, { expected: test.a });
    }
  } catch (error) {
    await db()
      .abTest.update({ where: { id: test.id }, data: { status: test.status } })
      .catch((e) => console.error("[ab-tests] status not restored (the hourly run does it)", test.id, errorMessage(e)));
    if (error instanceof HttpError && error.status === 409 && /changed in Shopify/.test(error.message)) {
      throw new HttpError(`The product's ${KIND_LABELS[test.kind].toLowerCase()} changed in Shopify since the test started, so B wasn't applied. Make the change in the fix center instead.`, 409);
    }
    throw error;
  }
  const updated = await db().abTest.update({
    where: { id: test.id },
    data: { status: "applied", fixId: fix?.id ?? null, ...(wasRunning ? { endReason: "used_b", result: stats, endedAt: new Date() } : {}) },
  });
  if (test.published) await unpublish(session, test, test.product.shopifyGid);
  return updated;
}

/**
 * A view or an add to cart from the storefront (only sent with the visitor's tracking consent). Counted
 * once per visitor; the version comes from the ids, whatever the storefront says. False when the test
 * isn't this shop's running test or the input isn't valid.
 */
export async function recordEvent(shopId, body) {
  const { test: testId, visitor, event } = body ?? {};
  if (!isTestId(testId) || !isVisitorId(visitor) || (event !== "view" && event !== "cart")) return false;
  const test = await db().abTest.findFirst({ where: { id: testId, shopId, status: "running" }, select: { id: true } });
  if (!test) return false;
  if (event === "view") {
    await db().$executeRaw`
      INSERT INTO "ab_test_visitors" ("test_id", "visitor_id", "variant", "viewed_at")
      VALUES (${testId}, ${visitor}, ${variantOf(testId, visitor)}, ${new Date()})
      ON CONFLICT ("test_id", "visitor_id") DO NOTHING`;
    return true;
  }
  // An add to cart counts only for a visitor counted with a view first.
  const carted = await db().$executeRaw`
    UPDATE "ab_test_visitors" SET "carted_at" = COALESCE("carted_at", ${new Date()})
    WHERE "test_id" = ${testId} AND "visitor_id" = ${visitor}`;
  return carted > 0;
}

async function countVisitor(testId, visitorId, carted, at = new Date()) {
  await db().$executeRaw`
    INSERT INTO "ab_test_visitors" ("test_id", "visitor_id", "variant", "viewed_at", "carted_at")
    VALUES (${testId}, ${visitorId}, ${variantOf(testId, visitorId)}, ${at}, ${carted ? at : null})
    ON CONFLICT ("test_id", "visitor_id") DO UPDATE SET "carted_at" = COALESCE("ab_test_visitors"."carted_at", EXCLUDED."carted_at")`;
}

/**
 * Stores purchases of tested products: order lines carrying a test's line item property (`testLines`),
 * with their stored quantity and revenue (`orderLines`, as the sync keeps them). Repeated or later
 * webhooks of the same order update the quantity (0 once cancelled). A buyer is a counted visitor.
 */
export async function recordTestPurchases(shopId, testLines, orderLines, orderedAt) {
  if (!testLines.length) return 0;
  const ids = [...new Set(testLines.map((l) => l.testId))];
  const tests = await db().abTest.findMany({
    where: { id: { in: ids }, shopId },
    select: { id: true, startedAt: true, endedAt: true, product: { select: { shopifyGid: true } } },
  });
  const known = new Map(tests.map((t) => [t.id, { productGid: t.product.shopifyGid, startedAt: t.startedAt, endedAt: t.endedAt }]));
  const purchases = purchasesFor(testLines, orderLines, known, orderedAt);
  for (const p of purchases) {
    const values = { orderGid: p.orderGid, visitorId: p.visitorId, variant: p.variant, quantity: p.quantity, revenue: p.revenue, orderedAt: p.orderedAt };
    await db().abTestPurchase.upsert({
      where: { testId_lineGid: { testId: p.testId, lineGid: p.lineGid } },
      create: { testId: p.testId, lineGid: p.lineGid, ...values },
      update: { quantity: p.quantity, revenue: p.revenue },
    });
    if (p.quantity > 0) await countVisitor(p.testId, p.visitorId, true, p.orderedAt);
  }
  return purchases.length;
}

/** The same for the nightly orders catch-up (orders JSONL and the lines made from it). */
export async function recordBulkPurchases(shopId, rows, orderLines) {
  const testLines = testLinesFromBulk(rows);
  if (!testLines.length) return 0;
  const orderedAt = new Map(rows.filter((r) => String(r.id ?? "").startsWith("gid://shopify/Order/") && r.createdAt).map((r) => [r.id, new Date(r.createdAt)]));
  return recordTestPurchases(shopId, testLines, orderLines, orderedAt);
}

/**
 * Hourly (with the plan runner), and after a plan change: ends running tests that are decided (95%
 * either way with enough visitors and days), 30 days old, no longer on the plan, or whose product
 * changed in Shopify or was deleted (the result would no longer be fair); puts back a metafield that
 * went missing; and retries taking ended tests off the storefront.
 */
export async function runAbTests(shopId, now = new Date()) {
  const shop = await db().shop.findUnique({ where: { id: shopId } });
  if (!shop || shop.uninstalledAt) return;
  const tests = await db().abTest.findMany({
    where: {
      shopId,
      OR: [
        { status: "running" },
        { published: true, status: { in: ["ended", "applied"] } },
        // A start or a "Use B now" that crashed half way: it would block the product's tests.
        { status: "starting", createdAt: { lt: new Date(now.getTime() - STALE_START_MS) } },
        { status: "applying", claimedAt: { lt: new Date(now.getTime() - STALE_APPLY_MS) } },
      ],
    },
    include: { product: { select: { shopifyGid: true } } },
  });
  await pruneEnded(shopId, now);
  if (!tests.length) return;
  const session = await getOfflineSession(shop.domain);
  for (const test of tests.filter((t) => t.status === "applying")) {
    try {
      test.status = await recoverApplying(session, test, now);
    } catch (error) {
      console.error("[ab-tests] crashed Use B now not recovered", test.id, errorMessage(error));
    }
  }
  // Its metafield may have been set: removed first, then the test (kept for the next run if that fails).
  for (const test of tests.filter((t) => t.status === "starting")) {
    if (await unpublish(session, test, test.product.shopifyGid)) await db().abTest.delete({ where: { id: test.id } });
  }
  const running = tests.filter((t) => t.status === "running");
  const stats = await statsFor(running.map((t) => t.id));
  const included = hasFeature(shop.plan, "abTests");
  let failure = null;

  for (const test of running) {
    try {
      const productGid = test.product.shopifyGid;
      let end = null;
      if (!included) end = { reason: "plan" };
      else {
        const live = await readLiveProduct(session, productGid);
        if (!live) end = { reason: "product_gone" };
        else if (!sameState(test.kind, stateOf(live, test.kind), test.a)) end = { reason: "changed" };
        else {
          const counted = stats.get(test.id).a.visitors + stats.get(test.id).b.visitors;
          const seen = await sessionsSince(test);
          const decision = decide(test.startedAt, stats.get(test.id), now, undefined, plausibleVisitors(counted, seen.sessions, seen.shopHasViews));
          if (decision.ended) end = { reason: decision.reason, winner: decision.winner };
          else if ((await publishedTestId(session, productGid)) !== test.id) await republish(session, test, productGid);
        }
      }
      if (!end) continue;
      const result = await endTest(session, test, productGid, end);
      if (result) {
        await notify({ shopId, type: "ab_test_ended", productId: test.productId, data: { kind: test.kind, reason: end.reason, winner: end.winner ?? null, chance: result.chance } });
      }
    } catch (error) {
      console.error("[ab-tests] check failed", test.id, errorMessage(error));
      failure ??= error;
    }
  }
  for (const test of tests.filter((t) => t.status === "ended" || t.status === "applied")) await unpublish(session, test, test.product.shopifyGid);
  if (failure) throw failure;
}

/** Shopify's visit sessions of the tested product since the test started, and whether the shop has visit data at all then. */
async function sessionsSince(test) {
  const since = new Date(new Date(test.startedAt).toISOString().slice(0, 10));
  const [own, shop] = await Promise.all([
    db().productDailyMetric.aggregate({ where: { productId: test.productId, date: { gte: since } }, _sum: { viewSessions: true } }),
    db().productDailyMetric.findFirst({ where: { product: { shopId: test.shopId }, date: { gte: since }, viewSessions: { gt: 0 } }, select: { productId: true } }),
  ]);
  return { sessions: own._sum.viewSessions ?? 0, shopHasViews: Boolean(shop) };
}

/** Browser ids of tests that ended over 30 days ago aren't kept: their numbers stay in the test's result. */
async function pruneEnded(shopId, now) {
  const old = { shopId, status: { in: ["ended", "applied"] }, endedAt: { lt: new Date(now.getTime() - KEEP_ENDED_MS) } };
  await db().abTestVisitor.deleteMany({ where: { test: old } });
  await db().abTestPurchase.deleteMany({ where: { test: old } });
}

/**
 * GDPR customers/redact: purchases of the orders to redact, and the browser ids that made them, are
 * removed from the shop's tests (nothing else there identifies a person).
 */
export async function redactTestOrders(domain, orderIds) {
  const orderGids = (orderIds ?? []).map((id) => `gid://shopify/Order/${id}`);
  if (!orderGids.length) return;
  const shops = await db().shop.findMany({ where: { domain }, select: { id: true } });
  for (const shop of shops) {
    const purchases = await db().abTestPurchase.findMany({ where: { orderGid: { in: orderGids }, test: { shopId: shop.id } }, select: { visitorId: true } });
    // One browser id per browser, shared by every test: removed from all of the shop's tests.
    const visitorIds = [...new Set(purchases.map((p) => p.visitorId))];
    if (visitorIds.length) {
      await db().abTestPurchase.deleteMany({ where: { visitorId: { in: visitorIds }, test: { shopId: shop.id } } });
      await db().abTestVisitor.deleteMany({ where: { visitorId: { in: visitorIds }, test: { shopId: shop.id } } });
    }
  }
}

/**
 * Puts a running test's metafield back (it went missing: removed by hand, or by an end that crossed a
 * check). Not when another test of the product is under way; and taken off again if the test was stopped
 * or B applied meanwhile, so an ended test never stays on the storefront.
 */
async function republish(session, test, productGid) {
  const status = async () => (await db().abTest.findUnique({ where: { id: test.id }, select: { status: true } }))?.status;
  const other = await db().abTest.findFirst({ where: { productId: test.productId, id: { not: test.id }, status: { in: ["starting", "running", "applying"] } }, select: { id: true } });
  if (other || (await status()) !== "running") return;
  await publish(session, productGid, test);
  await db().abTest.update({ where: { id: test.id }, data: { published: true } });
  if ((await status()) !== "running") await unpublish(session, test, productGid);
}

/**
 * A "Use B now" that crashed: when the product shows B, B is in use (with the fix made for it, if
 * any); otherwise the test goes back to where it was (running, or ended). Returns the new status.
 */
async function recoverApplying(session, test, now) {
  const live = await readLiveProduct(session, test.product.shopifyGid);
  if (live && sameState(test.kind, stateOf(live, test.kind), test.b)) {
    const fix = await db().fix.findFirst({
      where: { productId: test.productId, type: test.kind, status: "applied", createdAt: { gte: test.claimedAt ?? test.startedAt } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    const ending = test.endedAt ? {} : { endReason: "used_b", result: (await statsFor([test.id])).get(test.id), endedAt: now };
    await db().abTest.update({ where: { id: test.id }, data: { status: "applied", fixId: fix?.id ?? null, ...ending } });
    return "applied";
  }
  const back = test.endedAt ? "ended" : "running";
  await db().abTest.update({ where: { id: test.id }, data: { status: back } });
  return back;
}

/** The tests for the A/B tests page: running first, then the newest ended ones, with their numbers. */
export async function listTests(shopId) {
  const tests = await db().abTest.findMany({
    where: { shopId, status: { not: "starting" } },
    orderBy: { startedAt: "desc" },
    take: 100,
    include: { product: { select: { id: true, title: true } } },
  });
  const live = await statsFor(tests.filter((t) => t.status === "running").map((t) => t.id));
  return tests
    .map((t) => ({
      id: t.id,
      product: t.product,
      kind: t.kind,
      status: t.status,
      a: versionView(t.kind, t.a, t.previews),
      b: versionView(t.kind, t.b, t.previews),
      startedAt: t.startedAt,
      endedAt: t.endedAt,
      endReason: t.endReason,
      winner: t.winner,
      fixId: t.fixId,
      stats: live.get(t.id) ?? t.result ?? null,
    }))
    .sort((x, y) => Number(y.status === "running") - Number(x.status === "running"));
}
