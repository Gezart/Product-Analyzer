import { db } from "@/lib/db";
import { diagnose, median, reasonSignature, type DiagnosisContext, type Reason } from "@/lib/diagnosis";
import { localDateKey } from "@/lib/jobs/schedule";
import { sanitizeThresholds } from "@/lib/scoring";

/** Rules version stored with each diagnosis (AI-written summaries come in v2). */
export const RULES_VERSION = "rules-v1";

const DAY_MS = 86_400_000;

async function sessions30(shopId: string, timeZone: string | null) {
  const today = new Date(`${localDateKey(new Date(), timeZone)}T00:00:00Z`);
  const rows = await db().productDailyMetric.groupBy({
    by: ["productId"],
    where: { product: { shopId }, date: { gte: new Date(today.getTime() - 30 * DAY_MS), lt: today } },
    _sum: { viewSessions: true, cartSessions: true, purchaseSessions: true },
  });
  return new Map(
    rows.map((r) => [r.productId, { views: r._sum.viewSessions ?? 0, carts: r._sum.cartSessions ?? 0, purchases: r._sum.purchaseSessions ?? 0 }]),
  );
}

async function buildContext(shopId: string, timeZone: string | null) {
  const [products, settings, sessions] = await Promise.all([
    db().product.findMany({ where: { shopId, status: "ACTIVE" }, select: { id: true, price: true, productType: true, collections: true } }),
    db().settings.findUnique({ where: { shopId }, select: { thresholds: true } }),
    sessions30(shopId, timeZone),
  ]);
  const minViews = sanitizeThresholds(settings?.thresholds).minViews;
  const push = <K,>(map: Map<K, number[]>, key: K, v: number) => {
    const list = map.get(key);
    if (list) list.push(v);
    else map.set(key, [v]);
  };

  const pricesByType = new Map<string, number[]>();
  const pricesByCollection = new Map<string, number[]>();
  const collectionViews = new Map<string, number>();
  const viewToCart: number[] = [];
  const cartToPurchase: number[] = [];
  for (const p of products) {
    const price = Number(p.price);
    if (p.productType) push(pricesByType, p.productType, price);
    for (const c of p.collections) push(pricesByCollection, c, price);
    const s = sessions.get(p.id);
    if (s) for (const c of p.collections) collectionViews.set(c, (collectionViews.get(c) ?? 0) + s.views);
    if (s && s.views >= minViews) {
      viewToCart.push(s.carts / s.views);
      if (s.carts > 0) cartToPurchase.push(s.purchases / s.carts);
    }
  }
  // Without any view data, traffic-based rules stay silent.
  const hasViews = [...collectionViews.values()].some((v) => v > 0);
  const context: DiagnosisContext = {
    pricesByType,
    pricesByCollection,
    activeProducts: products.length,
    collectionViews: hasViews ? collectionViews : new Map(),
    medianViewToCart: median(viewToCart),
    medianCartToPurchase: median(cartToPurchase),
    minViews,
  };
  return { context, sessions };
}

/** Other active products with the same (normalized) description, found in SQL without loading every text. */
async function sameDescription(shopId: string, productId: string): Promise<string[]> {
  const rows = await db().$queryRaw<{ id: string }[]>`
    SELECT o."id" FROM "products" o, "products" p
    WHERE p."id" = ${productId} AND p."shop_id" = ${shopId} AND p."description_words" >= 20 AND p."description" IS NOT NULL
      AND o."shop_id" = ${shopId} AND o."id" <> p."id" AND o."status" = 'ACTIVE' AND o."description" IS NOT NULL
      AND md5(lower(btrim(regexp_replace(o."description", '\\s+', ' ', 'g'))))
        = md5(lower(btrim(regexp_replace(p."description", '\\s+', ' ', 'g'))))
    ORDER BY o."id"
  `;
  return rows.map((r) => r.id);
}

/**
 * Diagnoses one product with the v1 rules. A new `diagnoses` row is stored only when the reasons
 * (or the items they name) changed, so the history shows when a problem appeared or was fixed.
 */
export async function diagnoseProduct(shopId: string, productId: string) {
  const shop = await db().shop.findUnique({ where: { id: shopId }, select: { timezone: true } });
  const product = await db().product.findFirst({
    where: { id: productId, shopId },
    include: { variants: { select: { options: true, inventoryQty: true, sellsWhenOut: true }, orderBy: { shopifyGid: "asc" } } },
  });
  if (!product) return null;
  const [{ context, sessions }, duplicates] = await Promise.all([
    buildContext(shopId, shop?.timezone ?? null),
    sameDescription(shopId, productId),
  ]);
  // Rows synced before the text was stored have words but no text: the next catalog refresh fills it.
  const pageDataKnown = product.description != null || product.descriptionWords === 0;
  const s = sessions.get(product.id);
  const reasons: Reason[] = diagnose(
    {
      id: product.id,
      active: product.status === "ACTIVE",
      price: Number(product.price),
      productType: product.productType,
      collections: product.collections,
      imageCount: product.imageCount,
      description: product.description,
      descriptionWords: product.descriptionWords,
      seoTitle: product.seoTitle,
      seoDescription: product.seoDescription,
      pageDataKnown,
      duplicateOf: pageDataKnown ? duplicates : null,
      variants: product.variants.map((v) => ({
        title: Object.values((v.options ?? {}) as Record<string, string>).join(" / ") || "Default",
        stock: v.inventoryQty,
        sellsWhenOut: v.sellsWhenOut,
      })),
      views30: s?.views ?? 0,
      carts30: s?.carts ?? 0,
      purchases30: s?.purchases ?? 0,
    },
    context,
  );

  const latest = await db().diagnosis.findFirst({ where: { productId }, orderBy: { createdAt: "desc" } });
  // Same reasons naming the same items → same diagnosis (the numbers shown are always fresh).
  if (latest && latest.modelVersion === RULES_VERSION && reasonSignature(latest.reasons as Reason[]) === reasonSignature(reasons)) {
    return { id: latest.id, reasons, createdAt: latest.createdAt };
  }
  const created = await db().diagnosis.create({
    data: { productId, reasons: reasons as unknown as object[], modelVersion: RULES_VERSION },
  });
  return { id: created.id, reasons, createdAt: created.createdAt };
}
