// The page builder as the app's page gets it: the saved blocks and product page, the titles of the
// products picked in "Use for", suggestions per product, and the theme editor links.

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { missingFeature } from "@/lib/feature-gate";
import { productSuggestions } from "@/lib/page-builder-suggestions";

/** The theme app extension's blocks: the page builder's blocks only, or the full product page. */
const BLOCK_HANDLE = "product-page";
const LAYOUT_HANDLE = "product-layout";

/** The theme editor on a product page with the app's block ready to add (Shopify's deep link). */
const themeEditorUrl = (domain, handle) =>
  `https://${domain}/admin/themes/current/editor?template=product&addAppBlockId=${env.shopifyApiKey}/${handle}&target=mainSection`;

/** Titles of the products picked in "Use for" (from synced products; unknown ids show the id). */
async function productTitles(shopId, pageBuilder) {
  const ids = [...new Set(pageBuilder.blocks.flatMap((b) => b.useFor.productIds))];
  if (!ids.length) return {};
  const rows = await db().product.findMany({ where: { shopId, shopifyGid: { in: ids } }, select: { shopifyGid: true, title: true } });
  return Object.fromEntries(rows.map((r) => [r.shopifyGid, r.title]));
}

/** The page builder page's data, as JSON. */
export async function pageBuilderAnswer(shop, pageBuilder) {
  const missing = missingFeature(shop, "pageBuilder");
  const [titles, boughtTogether, suggestions] = await Promise.all([
    productTitles(shop.id, pageBuilder),
    db().product.count({ where: { shopId: shop.id, NOT: { boughtTogether: { isEmpty: true } } } }),
    missing ? [] : productSuggestions(shop.id, pageBuilder),
  ]);
  return Response.json({
    pageBuilder,
    productTitles: titles,
    boughtTogetherProducts: boughtTogether,
    suggestions,
    themeEditorUrl: themeEditorUrl(shop.domain, BLOCK_HANDLE),
    layoutEditorUrl: themeEditorUrl(shop.domain, LAYOUT_HANDLE),
    ...(missing ?? {}),
  });
}
