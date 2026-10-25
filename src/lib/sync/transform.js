// Turns bulk-operation JSONL rows into records we store. Pure, relative imports only, so node:test can load it.
import { round2 } from "../dates.js";
import { localDateKey } from "../jobs/schedule.js";

const num = (v) => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

const str = (v) => (typeof v === "string" && v !== "" ? v : null);

export function wordCount(text) {
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

const isType = (id, type) => typeof id === "string" && id.startsWith(`gid://shopify/${type}/`);

/** Products JSONL (products + child collections + child variants) → product records. */
export function assembleProducts(rows) {
  const products = new Map();
  const children = [];

  for (const row of rows) {
    if (isType(row.id, "Product") && !row.__parentId) {
      products.set(row.id, {
        gid: row.id,
        title: str(row.title) ?? "",
        handle: str(row.handle) ?? "",
        productType: str(row.productType),
        vendor: str(row.vendor),
        status: str(row.status) ?? "ACTIVE",
        createdAt: typeof row.createdAt === "string" ? new Date(row.createdAt) : null,
        descriptionWords: wordCount(str(row.description)),
        description: str(row.description)?.slice(0, 5000) ?? null,
        seoTitle: str((row.seo)?.title),
        seoDescription: str((row.seo)?.description),
        imageCount: num((row.mediaCount)?.count) ?? 0,
        price: 0,
        compareAtPrice: null,
        collections: [],
        variants: [],
      });
    } else if (row.__parentId) {
      children.push(row);
    }
  }

  const compareAt = new Map();
  for (const row of children) {
    const product = products.get(row.__parentId);
    if (!product) continue;
    if (isType(row.id, "Collection")) {
      product.collections.push(row.id);
    } else if (isType(row.id, "ProductVariant")) {
      const options = Object.fromEntries(
        ((row.selectedOptions) ?? []).map((o) => [o.name, o.value]),
      );
      const item = row.inventoryItem;
      const unitCost = item?.unitCost?.amount;
      product.variants.push({
        gid: row.id,
        sku: str(row.sku),
        options,
        price: num(row.price) ?? 0,
        cost: num(unitCost),
        inventoryQty: num(row.inventoryQuantity) ?? 0,
        sellsWhenOut: item?.tracked === false || row.inventoryPolicy === "CONTINUE",
      });
      compareAt.set(row.id, num(row.compareAtPrice));
    }
  }

  for (const product of products.values()) {
    const cheapest = [...product.variants].sort((a, b) => a.price - b.price)[0];
    if (cheapest) {
      product.price = cheapest.price;
      product.compareAtPrice = compareAt.get(cheapest.gid) ?? null;
    }
  }
  return [...products.values()];
}

const money = (v) => num(v?.shopMoney?.amount) ?? 0;

/**
 * Orders JSONL (orders + child line items) → order lines. Only date, cancellation, product, variant,
 * quantity and price are read; no customer data is requested or kept. Lines of deleted products are skipped.
 */
export function orderLinesFromBulk(rows, timeZone) {
  const orders = new Map();
  for (const row of rows) {
    if (isType(row.id, "Order") && typeof row.createdAt === "string") {
      orders.set(row.id, {
        date: localDateKey(new Date(row.createdAt), timeZone),
        cancelled: Boolean(row.cancelledAt),
        updatedAt: new Date(typeof row.updatedAt === "string" ? row.updatedAt : row.createdAt),
      });
    }
  }
  const lines = [];
  for (const row of rows) {
    if (!row.__parentId || !isType(row.id, "LineItem")) continue;
    const order = orders.get(row.__parentId);
    const productGid = (row.product)?.id;
    if (!order || !productGid) continue;
    const quantity = order.cancelled ? 0 : Math.max(0, num(row.currentQuantity) ?? 0);
    lines.push({
      lineGid: row.id,
      orderGid: row.__parentId,
      productGid,
      variantGid: (row.variant)?.id ?? null,
      date: order.date,
      quantity,
      revenue: round2(quantity * money(row.discountedUnitPriceAfterAllDiscountsSet)),
      orderUpdatedAt: order.updatedAt,
    });
  }
  return lines;
}

/**
 * orders/create|updated|cancelled webhook payload (REST shape) → order lines, same rules as the bulk
 * import. Revenue: (price × quantity − discount allocations), scaled to the current quantity.
 */
export function orderLinesFromWebhook(order, timeZone) {
  const orderGid = order.admin_graphql_api_id ?? (order.id ? `gid://shopify/Order/${order.id}` : null);
  if (!orderGid || !order.created_at) return [];
  const date = localDateKey(new Date(order.created_at), timeZone);
  const updatedAt = new Date(order.updated_at ?? order.created_at);
  const cancelled = Boolean(order.cancelled_at);
  return (order.line_items ?? []).flatMap((item) => {
    if (!item.product_id) return [];
    const lineGid = item.admin_graphql_api_id ?? `gid://shopify/LineItem/${item.id}`;
    const ordered = item.quantity ?? 0;
    const quantity = cancelled ? 0 : Math.max(0, item.current_quantity ?? ordered);
    const gross = (num(item.price) ?? 0) * ordered;
    const discounts = (item.discount_allocations ?? []).reduce((sum, d) => sum + (num(d.amount) ?? 0), 0);
    const revenue = ordered > 0 ? round2(((gross - discounts) * quantity) / ordered) : 0;
    return [
      {
        lineGid,
        orderGid,
        productGid: `gid://shopify/Product/${item.product_id}`,
        variantGid: item.variant_id ? `gid://shopify/ProductVariant/${item.variant_id}` : null,
        date,
        quantity,
        revenue: Math.max(0, revenue),
        orderUpdatedAt: updatedAt,
      },
    ];
  });
}

/** Single-product GraphQL result → the same row shape as bulk JSONL, for `assembleProducts`. */
export function rowsFromProductNode(node) {
  const { collections, variants, ...product } = node;
  return [
    product,
    ...(collections?.nodes ?? []).map((c) => ({ id: c.id, __parentId: node.id })),
    ...(variants?.nodes ?? []).map((v) => ({ ...v, __parentId: node.id })),
  ];
}

/** Incremental JSONL parser: feed text chunks, get complete rows; a line split across chunks is kept until it ends. */
export function createJsonlParser() {
  let buffer = "";
  const parse = (lines) => lines.filter((l) => l.trim()).map((l) => JSON.parse(l));
  return {
    push(text) {
      buffer += text;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      return parse(lines);
    },
    end() {
      const rest = parse([buffer]);
      buffer = "";
      return rest;
    },
  };
}
