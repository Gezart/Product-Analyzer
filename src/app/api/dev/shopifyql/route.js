import { authenticate, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { viewQueries, viewRows } from "@/lib/shopifyql";
import { runShopifyql, shopifyqlEnvironment } from "@/lib/shopifyql-shopify";

const message = (e) => (e instanceof Error ? e.message : String(e)).slice(0, 1000);

/**
 * ShopifyQL check (development only): which scope the store granted, what the API's ShopifyQL types
 * look like, and what each candidate views query returns for 90 days. The result tells views-sync
 * which query to use.
 */
export async function GET(request) {
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 });
  try {
    const { shop, session } = await authenticate(request);
    let environment;
    try {
      environment = await shopifyqlEnvironment(session);
    } catch (e) {
      environment = { error: message(e) };
    }
    const results = [];
    for (const { id, query } of viewQueries(90)) {
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
          sample: r.rows.slice(0, 5),
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
  } catch (error) {
    if (error instanceof AuthError) return new Response("Unauthorized", { status: 401 });
    throw error;
  }
}
