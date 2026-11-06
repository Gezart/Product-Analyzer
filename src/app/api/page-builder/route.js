import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { missingFeature, requireFeature } from "@/lib/feature-gate";
import { enqueue } from "@/lib/jobs/queue";
import { blockEnabled, pageBuilderOf, validatePageBuilder } from "@/lib/page-builder";
import { publishPageBuilder } from "@/lib/page-builder-shopify";
import { appRoute, readJson } from "@/lib/route";

/** The theme app extension's product page block (blocks/product-page.liquid). */
const BLOCK_HANDLE = "product-page";

/** The theme editor on a product page with the app's block ready to add (Shopify's deep link). */
const themeEditorUrl = (domain) =>
  `https://${domain}/admin/themes/current/editor?template=product&addAppBlockId=${env.shopifyApiKey}/${BLOCK_HANDLE}&target=mainSection`;

/** Titles of the products picked in "Use for" (from synced products; unknown ids show the id). */
async function productTitles(shopId, pageBuilder) {
  const ids = [...new Set(pageBuilder.blocks.flatMap((b) => b.useFor.productIds))];
  if (!ids.length) return {};
  const rows = await db().product.findMany({ where: { shopId, shopifyGid: { in: ids } }, select: { shopifyGid: true, title: true } });
  return Object.fromEntries(rows.map((r) => [r.shopifyGid, r.title]));
}

async function answer(shop, pageBuilder) {
  const [titles, boughtTogether] = await Promise.all([
    productTitles(shop.id, pageBuilder),
    db().product.count({ where: { shopId: shop.id, NOT: { boughtTogether: { isEmpty: true } } } }),
  ]);
  const missing = missingFeature(shop, "pageBuilder");
  return Response.json({
    pageBuilder,
    productTitles: titles,
    boughtTogetherProducts: boughtTogether,
    themeEditorUrl: themeEditorUrl(shop.domain),
    ...(missing ?? {}),
  });
}

/** Queues the page builder job ("often bought together"), unless one is already waiting. */
async function queueRefresh(shopId) {
  const pending = await db().job.findFirst({ where: { shopId, type: "page-builder", status: "queued" }, select: { id: true } });
  if (!pending) await enqueue({ type: "page-builder", shopId });
}

export const GET = appRoute(async ({ shop }) => {
  const row = await db().settings.findUnique({ where: { shopId: shop.id }, select: { pageBuilder: true } });
  return answer(shop, pageBuilderOf(row?.pageBuilder));
});

// Publishes the blocks to the storefront first, then stores them: a save Shopify refuses changes nothing.
export const PUT = appRoute(async ({ request, shop, session }) => {
  requireFeature(shop, "pageBuilder");
  const result = validatePageBuilder(await readJson(request));
  if (!result.ok) return Response.json({ errors: result.errors }, { status: 400 });

  const pageBuilder = result.value;
  await publishPageBuilder(session, pageBuilder, shop.plan);
  await db().settings.upsert({ where: { shopId: shop.id }, create: { shopId: shop.id, pageBuilder }, update: { pageBuilder } });
  if (blockEnabled(pageBuilder, "bought_together")) await queueRefresh(shop.id);

  return answer(shop, pageBuilder);
});
