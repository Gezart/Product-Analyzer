import { db } from "@/lib/db";
import { errorMessage } from "@/lib/http-error";
import { localDateKey } from "@/lib/jobs/schedule";
import { appRoute } from "@/lib/route";
import { chunkRange, viewQueries, viewRange, viewRows } from "@/lib/shopifyql";
import { runShopifyql, shopifyqlEnvironment } from "@/lib/shopifyql-shopify";

const message = (e) => errorMessage(e, 1000);

/**
 * ShopifyQL check (development only): which scope the store granted, what the API's ShopifyQL types
 * look like, and what each candidate views query returns for 90 days. The result tells views-sync
 * which query to use.
 */
export async function GET(request, ctx) {
  if (process.env.NODE_ENV === "production") return Response.json({ error: "Not found" }, { status: 404 });
  return check(request, ctx);
}

const check = appRoute(async ({ shop, session }) => {
  let environment;
  try {
    environment = await shopifyqlEnvironment(session);
  } catch (e) {
    environment = { error: message(e) };
  }
  const results = [];
  const range = viewRange(localDateKey(new Date(), shop.timezone), 90);
  // The whole 90 days in one query, and the last week alone (to see whether answers are capped).
  const lastWeek = chunkRange(range, 7).at(-1);
  const candidates = [
    ...viewQueries(range).map((c) => ({ ...c, id: `${c.id} (90 days)` })),
    ...viewQueries(lastWeek).map((c) => ({ ...c, id: `${c.id} (last 7 days)` })),
  ];
  for (const { id, query } of candidates) {
    try {
      const r = await runShopifyql(session, query);
      const rows = r.ok ? viewRows(r.rows) : [];
      const gids = [...new Set(rows.map((x) => x.productGid))];
      const known = gids.length ? await db().product.count({ where: { shopId: shop.id, shopifyGid: { in: gids } } }) : 0;
      const dates = rows.map((x) => x.date).sort();
      results.push({
        id,
        query,
        ok: r.ok,
        parseErrors: r.parseErrors,
        columns: r.columns.map((c) => `${c.name} (${c.dataType})`),
        rows: r.rows.length,
        rawRows: r.rawCount ?? null,
        sample: r.rows.slice(0, 5),
        raw: r.rows.length ? undefined : r.raw,
        viewRows: rows.length,
        products: gids.length,
        productsKnownToApp: known,
        from: dates[0] ?? null,
        to: dates.at(-1) ?? null,
        totalViews: rows.reduce((s, x) => s + x.views, 0),
      });
    } catch (e) {
      results.push({ id, query, ok: false, error: message(e) });
    }
  }
  return Response.json({ shop: shop.domain, checkedAt: new Date().toISOString(), environment, results });
});
