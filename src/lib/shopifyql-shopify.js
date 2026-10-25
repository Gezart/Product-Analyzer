import { adminGraphql } from "@/lib/admin";
import { tableRows } from "@/lib/shopifyql";

/**
 * Runs a ShopifyQL query (GraphQL Admin API 2025-10+, needs the read_reports scope).
 * Returns the rows as objects, or the query's parse errors.
 */
export async function runShopifyql(session, query) {
  const data = await adminGraphql(
    session,
    `#graphql
    query ShopifyQL($query: String!) {
      shopifyqlQuery(query: $query) {
        tableData { columns { name dataType displayName } rows }
        parseErrors
      }
    }`,
    { query },
  );
  const r = data.shopifyqlQuery;
  if (r?.parseErrors?.length) return { ok: false, parseErrors: r.parseErrors, columns: [], rows: [] };
  const columns = r?.tableData?.columns ?? [];
  return { ok: true, parseErrors: [], columns, rows: tableRows(columns, r?.tableData?.rows) };
}

/** What the store's API says about ShopifyQL: the granted scopes and the response type's fields. */
export async function shopifyqlEnvironment(session) {
  const data = await adminGraphql(
    session,
    `#graphql
    query ShopifyQLEnvironment {
      currentAppInstallation { accessScopes { handle } }
      response: __type(name: "ShopifyqlQueryResponse") { fields { name type { kind name ofType { kind name ofType { name } } } } }
      table: __type(name: "ShopifyqlTableData") { fields { name type { kind name ofType { kind name } } } }
    }`,
  );
  const fields = (t) => (t?.fields ?? []).map((f) => `${f.name}: ${f.type.name ?? f.type.ofType?.name ?? f.type.ofType?.ofType?.name ?? f.type.kind}`);
  return {
    scopes: data.currentAppInstallation.accessScopes.map((s) => s.handle),
    responseFields: fields(data.response),
    tableFields: fields(data.table),
  };
}
