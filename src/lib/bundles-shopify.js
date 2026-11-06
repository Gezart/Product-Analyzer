// Bundles in Shopify and the database: the automatic discount ("buy the bestseller, get the stuck
// product X% off"), the offer on the bestseller's page (its app-owned `$app.bundle` metafields), the
// suggestions, what each bundle did, and when one ends.

import { adminGraphql } from "@/lib/admin";
import { getOfflineSession } from "@/lib/auth";
import { bundleEffect, endReason, maxBundlePct, ordersTogether, suggestBundles, validateBundle } from "@/lib/bundles";
import { asDate, dateKey, shiftDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { errorMessage, HttpError } from "@/lib/http-error";
import { localDateKey } from "@/lib/jobs/schedule";
import { readLiveVariants } from "@/lib/markdown-shopify";
import { notify } from "@/lib/notify";
import { hasFeature } from "@/lib/plans";

const APP_NAMESPACE = "$app";
/** A bundle still "starting" after this crashed while it was being set up. */
const STALE_START_MS = 10 * 60_000;
const DEFAULT_SETTINGS = { marginFloorPct: 10, maxDiscountPct: 40 };
/**
 * A bundle's discount ends by itself this long after its last check (pushed forward hourly while the
 * bundle stays valid): if the app can't manage it any more (uninstalled, token refused, a failure), it
 * still stops in Shopify on its own.
 */
const LEASE_MS = 48 * 3_600_000;
/** The lease is pushed forward once less than this is left. */
const RENEW_MS = 24 * 3_600_000;

const DISCOUNT_CREATE = `#graphql
  mutation BundleDiscount($discount: DiscountAutomaticBxgyInput!) {
    discountAutomaticBxgyCreate(automaticBxgyDiscount: $discount) {
      automaticDiscountNode { id }
      userErrors { field message }
    }
  }`;

const DISCOUNTS_BY_TITLE = `#graphql
  query BundleDiscountsByTitle($query: String!) {
    automaticDiscountNodes(first: 25, reverse: true, query: $query) {
      nodes { id automaticDiscount { ... on DiscountAutomaticBxgy { title status createdAt } } }
    }
  }`;

const DISCOUNT_RENEW = `#graphql
  mutation BundleDiscountRenew($id: ID!, $discount: DiscountAutomaticBxgyInput!) {
    discountAutomaticBxgyUpdate(id: $id, automaticBxgyDiscount: $discount) { automaticDiscountNode { id } userErrors { field message } }
  }`;

const DISCOUNT_END = `#graphql
  mutation BundleDiscountEnd($id: ID!) {
    discountAutomaticDeactivate(id: $id) { automaticDiscountNode { id } userErrors { field message } }
  }`;

const OFFER_READ = `#graphql
  query BundleOffer($id: ID!) { product(id: $id) { metafield(namespace: "${APP_NAMESPACE}", key: "bundle") { value } } }`;

const METAFIELDS_SET = `#graphql
  mutation BundleOfferSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message } }
  }`;

const METAFIELDS_DELETE = `#graphql
  mutation BundleOfferDelete($metafields: [MetafieldIdentifierInput!]!) {
    metafieldsDelete(metafields: $metafields) { deletedMetafields { key } userErrors { field message } }
  }`;

const errorsText = (errors) => errors.map((e) => e.message).join("; ");

/** Shop's margin floor and max discount (the markdown settings), as numbers. */
async function discountSettings(shopId) {
  const s = await db().settings.findUnique({ where: { shopId }, select: { marginFloorPct: true, maxDiscountPct: true } });
  return s ? { marginFloorPct: Number(s.marginFloorPct), maxDiscountPct: Number(s.maxDiscountPct) } : DEFAULT_SETTINGS;
}

/** Units in stock that can be sold (variants that sell at 0 count as available). */
const stockOf = (variants) => (variants.some((v) => v.sellsWhenOut) ? Infinity : variants.reduce((s, v) => s + Math.max(0, v.inventoryQty), 0));

/**
 * Every active, analyzed product with what bundles need: status, money at stake, rising, stock, units
 * sold in 30 days, collections, type, the discount its floor allows, and whether it's in a running bundle.
 */
async function productFacts(shop) {
  const today = localDateKey(new Date(), shop.timezone);
  const [rows, variants, units, running, settings] = await Promise.all([
    db().$queryRaw`
      SELECT p."id", p."shopify_gid" AS "gid", p."title", p."collections", p."product_type" AS "productType",
        s."status", s."money_at_stake"::float AS "moneyAtStake", s."rising"
      FROM "products" p
      CROSS JOIN LATERAL (SELECT x."status", x."money_at_stake", x."rising" FROM "product_scores" x WHERE x."product_id" = p."id" ORDER BY x."computed_at" DESC LIMIT 1) s
      WHERE p."shop_id" = ${shop.id} AND p."status" = 'ACTIVE' AND s."status" NOT IN ('over_limit', 'excluded')`,
    db().variant.findMany({ where: { product: { shopId: shop.id, status: "ACTIVE" } }, select: { productId: true, price: true, cost: true, inventoryQty: true, sellsWhenOut: true } }),
    db().productDailyMetric.groupBy({
      by: ["productId"],
      where: { product: { shopId: shop.id }, date: { gte: asDate(shiftDate(today, -30)), lt: asDate(today) } },
      _sum: { units: true },
    }),
    db().bundle.findMany({ where: { shopId: shop.id, status: { in: ["starting", "active"] } }, select: { productId: true, partnerId: true } }),
    discountSettings(shop.id),
  ]);
  const variantsOf = new Map();
  for (const v of variants) variantsOf.set(v.productId, [...(variantsOf.get(v.productId) ?? []), v]);
  const unitsOf = new Map(units.map((u) => [u.productId, u._sum.units ?? 0]));
  const bundled = new Set(running.flatMap((b) => [b.productId, b.partnerId]));
  return rows.map((p) => {
    const own = variantsOf.get(p.id) ?? [];
    return { ...p, stock: stockOf(own), units30: unitsOf.get(p.id) ?? 0, maxPct: maxBundlePct(own, settings).pct, bundled: bundled.has(p.id) };
  });
}

/** Order lines of the last 60 days (which products were bought together). */
async function recentLines(shopId) {
  return db().orderLine.findMany({ where: { shopId, quantity: { gt: 0 }, date: { gte: new Date(Date.now() - 60 * 86_400_000) } }, select: { orderGid: true, productGid: true } });
}

/**
 * The bundle's live discounts in Shopify: its own, and any made for it whose id never came back (an
 * answer lost on the way, or a retried request), found by its title and created since the bundle.
 */
async function liveDiscounts(session, bundle) {
  const ids = new Set(bundle.discountGid ? [bundle.discountGid] : []);
  const data = await adminGraphql(session, DISCOUNTS_BY_TITLE, { query: `title:"${bundle.title.replace(/["\\]/g, " ")}"` });
  const since = new Date(bundle.createdAt).getTime() - 60_000;
  // A later bundle of the same two products has the same title: its discount isn't this one's.
  const others = await db().bundle.findMany({
    where: { shopId: bundle.shopId, id: { not: bundle.id }, title: bundle.title, discountGid: { not: null } },
    select: { discountGid: true },
  });
  const theirs = new Set(others.map((b) => b.discountGid));
  for (const node of data.automaticDiscountNodes?.nodes ?? []) {
    const d = node.automaticDiscount;
    if (d?.title === bundle.title && d.status !== "EXPIRED" && new Date(d.createdAt).getTime() >= since && !theirs.has(node.id)) ids.add(node.id);
  }
  return [...ids];
}

async function setOffer(session, partnerGid, bundle, productGid) {
  const data = await adminGraphql(session, METAFIELDS_SET, {
    metafields: [
      { ownerId: partnerGid, namespace: APP_NAMESPACE, key: "bundle", type: "json", value: JSON.stringify({ id: bundle.id, pct: bundle.pct }) },
      { ownerId: partnerGid, namespace: APP_NAMESPACE, key: "bundle_product", type: "product_reference", value: productGid },
    ],
  });
  const errors = data.metafieldsSet.userErrors;
  if (errors.length) throw new HttpError(`Shopify didn't save the offer: ${errorsText(errors)}`, 502);
}

/**
 * Takes a bundle off Shopify: the discount ends (kept in Shopify's discount list, inactive) and the offer
 * leaves the partner's page when it still shows this bundle. Resolves whether both are done.
 */
async function clearShopify(session, bundle, partnerGid) {
  try {
    for (const id of await liveDiscounts(session, bundle)) {
      const data = await adminGraphql(session, DISCOUNT_END, { id });
      const errors = data.discountAutomaticDeactivate.userErrors;
      // Already ended or deleted by the merchant in Shopify: nothing left to end.
      if (errors.length && !errors.every((e) => /not found|does not exist|already|expired|ended/i.test(e.message))) throw new Error(errorsText(errors));
    }
    const offer = await adminGraphql(session, OFFER_READ, { id: partnerGid });
    let shown = null;
    try {
      shown = JSON.parse(offer.product?.metafield?.value ?? "null")?.id ?? null;
    } catch {}
    if (shown === bundle.id) {
      const data = await adminGraphql(session, METAFIELDS_DELETE, {
        metafields: ["bundle", "bundle_product"].map((key) => ({ ownerId: partnerGid, namespace: APP_NAMESPACE, key })),
      });
      const errors = data.metafieldsDelete.userErrors;
      if (errors.length) throw new Error(errorsText(errors));
    }
    return true;
  } catch (error) {
    console.error("[bundles] not cleared in Shopify yet (retried nightly)", bundle.id, errorMessage(error));
    return false;
  }
}

/**
 * Starts a bundle: checks both products (active, not in another running bundle) and the discount
 * against the stuck product's floor, creates the Shopify discount, then the offer on the partner's page.
 * Anything Shopify refuses is undone, so nothing is left half set up.
 */
export async function startBundle(shop, body) {
  const gids = [body?.productGid, body?.partnerGid];
  if (!gids.every((g) => typeof g === "string" && /^gid:\/\/shopify\/Product\/\d+$/.test(g))) throw new HttpError("Choose the two products.", 400);
  const [product, partner] = await Promise.all(
    gids.map((gid) => db().product.findFirst({ where: { shopId: shop.id, shopifyGid: gid }, include: { variants: true } })),
  );
  if (!product || !partner) throw new HttpError("Product not found", 404);
  if (product.status !== "ACTIVE" || partner.status !== "ACTIVE") throw new HttpError("Both products must be active in Shopify.", 400);
  // Two discounts on one product would add up under the floor: a markdown and a bundle don't run together.
  const markdown = await db().markdownPlan.findFirst({ where: { productId: product.id, status: { in: ["active", "paused"] } }, select: { id: true } });
  if (markdown) throw new HttpError(`A markdown is running on ${product.title}. End it first: the two discounts would add up.`, 409);
  const session = await getOfflineSession(shop.domain);
  // Prices and costs as they are in Shopify now (a change may not be synced yet).
  const live = await readLiveVariants(session, product.shopifyGid);
  if (!live) throw new HttpError("Product no longer exists in Shopify", 404);
  const max = maxBundlePct(live, await discountSettings(shop.id));
  const valid = validateBundle({ productId: product.id, partnerId: partner.id, pct: body?.pct }, max.pct);
  if (!valid.ok) throw new HttpError(max.reason && !max.pct ? max.reason : valid.error, 400);
  if (stockOf(product.variants) <= 0) throw new HttpError(`${product.title} is out of stock.`, 400);

  let bundle;
  try {
    // Shoppers see the title in the cart.
    const title = `Buy together: ${partner.title} + ${product.title}`.slice(0, 255);
    bundle = await db().bundle.create({ data: { shopId: shop.id, productId: product.id, partnerId: partner.id, pct: valid.value.pct, title } });
  } catch (error) {
    if (error?.code === "P2002") throw new HttpError("One of these products is already in a running bundle.", 409);
    throw error;
  }
  const endsAt = new Date(Date.now() + LEASE_MS);
  try {
    const data = await adminGraphql(session, DISCOUNT_CREATE, {
      discount: {
        title: bundle.title,
        startsAt: new Date().toISOString(),
        endsAt: endsAt.toISOString(),
        // Not with discount codes on the order either: they would take the bundled unit under its floor.
        combinesWith: { productDiscounts: false, orderDiscounts: false, shippingDiscounts: true },
        customerBuys: { items: { products: { productsToAdd: [partner.shopifyGid] } }, value: { quantity: "1" } },
        customerGets: { items: { products: { productsToAdd: [product.shopifyGid] } }, value: { discountOnQuantity: { quantity: "1", effect: { percentage: bundle.pct / 100 } } } },
        usesPerOrderLimit: "1",
      },
    });
    const errors = data.discountAutomaticBxgyCreate.userErrors;
    if (errors.length) throw new HttpError(`Shopify didn't create the discount: ${errorsText(errors)}`, 502);
    bundle = await db().bundle.update({ where: { id: bundle.id }, data: { discountGid: data.discountAutomaticBxgyCreate.automaticDiscountNode.id } });
    await setOffer(session, partner.shopifyGid, bundle, product.shopifyGid);
  } catch (error) {
    // Undo what got through; if that fails too, the nightly run cleans up the "starting" bundle.
    if (await clearShopify(session, bundle, partner.shopifyGid)) await db().bundle.delete({ where: { id: bundle.id } }).catch(() => {});
    throw error;
  }
  return db().bundle.update({ where: { id: bundle.id }, data: { status: "active", startedAt: new Date(), endsAt } });
}

/**
 * Ends a running bundle (claimed first, so it ends once) and takes it off Shopify: `{ ended, cleared }`
 * (`cleared` false: Shopify didn't confirm; retried hourly, and the discount's lease ends it anyway).
 */
async function finish(session, bundle, partnerGid, reason) {
  const claimed = await db().bundle.updateMany({ where: { id: bundle.id, status: "active" }, data: { status: "ended", endReason: reason, endedAt: new Date(), cleanup: true } });
  if (!claimed.count) return { ended: false, cleared: false };
  const cleared = await clearShopify(session, bundle, partnerGid);
  if (cleared) await db().bundle.update({ where: { id: bundle.id }, data: { cleanup: false } });
  return { ended: true, cleared };
}

/** The merchant ends a bundle: the discount stops and the offer leaves the page. Resolves whether Shopify confirmed it. */
export async function endBundle(shop, bundleId) {
  const bundle = await db().bundle.findFirst({ where: { id: bundleId, shopId: shop.id }, include: { partner: { select: { shopifyGid: true } } } });
  if (!bundle) throw new HttpError("Bundle not found", 404);
  const { ended, cleared } = await finish(await getOfflineSession(shop.domain), bundle, bundle.partner.shopifyGid, "stopped");
  if (!ended) throw new HttpError("This bundle isn't running.", 409);
  return { cleared, endsAt: bundle.endsAt };
}

/**
 * Hourly (with the plan runner), nightly, after a plan change and right after a bundled product changes:
 * ends running bundles that can't go on (the stuck product sold out, a product was removed, its floor no
 * longer allows the discount at Shopify's prices and costs now, or the plan no longer includes bundles)
 * with an inbox note, pushes the discount's lease forward for the others, retries clearing Shopify for
 * ended ones, and cleans up starts that crashed.
 */
export async function runBundles(shopId, now = new Date()) {
  const shop = await db().shop.findUnique({ where: { id: shopId } });
  if (!shop || shop.uninstalledAt) return;
  const bundles = await db().bundle.findMany({
    where: {
      shopId,
      OR: [{ status: "active" }, { status: "ended", cleanup: true }, { status: "starting", createdAt: { lt: new Date(now.getTime() - STALE_START_MS) } }],
    },
    include: { product: { include: { variants: true } }, partner: { select: { shopifyGid: true, status: true } } },
  });
  if (!bundles.length) return;
  const session = await getOfflineSession(shop.domain);
  const settings = await discountSettings(shopId);
  const included = hasFeature(shop.plan, "bundles");
  let failure = null;
  for (const bundle of bundles) {
    try {
      if (bundle.status === "starting") {
        if (await clearShopify(session, bundle, bundle.partner.shopifyGid)) await db().bundle.delete({ where: { id: bundle.id } });
        continue;
      }
      if (bundle.status === "ended") {
        if (await clearShopify(session, bundle, bundle.partner.shopifyGid)) await db().bundle.update({ where: { id: bundle.id }, data: { cleanup: false } });
        continue;
      }
      const live = included ? await readLiveVariants(session, bundle.product.shopifyGid) : null;
      const reason = endReason({
        included,
        productActive: bundle.product.status === "ACTIVE" && (!included || live != null),
        partnerActive: bundle.partner.status === "ACTIVE",
        stock: stockOf(bundle.product.variants),
        maxPct: live ? maxBundlePct(live, settings).pct : 0,
        pct: bundle.pct,
      });
      if (reason) {
        if ((await finish(session, bundle, bundle.partner.shopifyGid, reason)).ended) {
          await notify({ shopId, type: "bundle_ended", productId: bundle.productId, data: { reason } });
        }
        continue;
      }
      if (bundle.discountGid && (!bundle.endsAt || bundle.endsAt.getTime() - now.getTime() < RENEW_MS)) {
        const endsAt = new Date(now.getTime() + LEASE_MS);
        const data = await adminGraphql(session, DISCOUNT_RENEW, { id: bundle.discountGid, discount: { endsAt: endsAt.toISOString() } });
        const errors = data.discountAutomaticBxgyUpdate.userErrors;
        if (errors.length) throw new Error(`Lease not renewed: ${errorsText(errors)}`);
        await db().bundle.update({ where: { id: bundle.id }, data: { endsAt } });
      }
    } catch (error) {
      console.error("[bundles] check failed", bundle.id, errorMessage(error));
      failure ??= error;
    }
  }
  if (failure) throw failure;
}

/**
 * The Bundles page: running and recent bundles with what each did, and suggestions (stuck products
 * paired with products that sell well, at a discount their floor allows).
 */
export async function listBundles(shop) {
  const today = localDateKey(new Date(), shop.timezone);
  const bundles = await db().bundle.findMany({
    where: { shopId: shop.id, status: { in: ["active", "ended"] } },
    orderBy: { startedAt: "desc" },
    take: 50,
    include: { product: { select: { id: true, title: true, shopifyGid: true } }, partner: { select: { id: true, title: true, shopifyGid: true } } },
  });
  const gids = [...new Set(bundles.flatMap((b) => [b.product.shopifyGid, b.partner.shopifyGid]))];
  const earliest = bundles.length ? shiftDate(bundles.map((b) => localDateKey(b.startedAt, shop.timezone)).sort()[0], -30) : today;
  const lines = gids.length
    ? (await db().orderLine.findMany({ where: { shopId: shop.id, productGid: { in: gids }, date: { gte: asDate(earliest) } } })).map((l) => ({ ...l, date: dateKey(l.date) }))
    : [];
  const list = bundles.map((b) => {
    const startedOn = localDateKey(b.startedAt, shop.timezone);
    const until = b.endedAt ? localDateKey(b.endedAt, shop.timezone) : today;
    const own = lines.filter((l) => (l.productGid === b.product.shopifyGid || l.productGid === b.partner.shopifyGid) && l.date <= until);
    return {
      id: b.id,
      status: b.status,
      pct: b.pct,
      product: { id: b.product.id, title: b.product.title, gid: b.product.shopifyGid },
      partner: { id: b.partner.id, title: b.partner.title, gid: b.partner.shopifyGid },
      startedAt: b.startedAt,
      endedAt: b.endedAt,
      endReason: b.endReason,
      effect: bundleEffect(own, { productGid: b.product.shopifyGid, partnerGid: b.partner.shopifyGid, startedOn, today: until }),
    };
  });
  const included = hasFeature(shop.plan, "bundles");
  const suggestions = included ? suggestBundles(await productFacts(shop), ordersTogether(await recentLines(shop.id))) : [];
  return {
    bundles: list,
    suggestions: suggestions.map((s) => ({
      product: { id: s.product.id, gid: s.product.gid, title: s.product.title, status: s.product.status, maxPct: s.product.maxPct },
      partner: { id: s.partner.id, gid: s.partner.gid, title: s.partner.title, units30: s.partner.units30 },
      pct: s.pct,
      why: s.why,
    })),
  };
}

/** The most a product can be discounted in a bundle (for a pair the merchant picks), with why when it can't. */
export async function bundleLimit(shop, productGid) {
  const product = await db().product.findFirst({ where: { shopId: shop.id, shopifyGid: productGid }, include: { variants: true } });
  if (!product) throw new HttpError("This product isn't in the app yet.", 404);
  return { id: product.id, gid: product.shopifyGid, title: product.title, ...maxBundlePct(product.variants, await discountSettings(shop.id)) };
}
