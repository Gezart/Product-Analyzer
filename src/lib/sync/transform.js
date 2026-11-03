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
        // Shopify allows 250 tags of up to 255 characters.
        tags: Array.isArray(row.tags) ? row.tags.filter((t) => typeof t === "string").slice(0, 250).map((t) => t.slice(0, 255)) : [],
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

// --- Returns ---

/** Orders with refunds, and orders with returns, in Shopify's order search. */
export const REFUNDED_SEARCH = "(financial_status:refunded OR financial_status:partially_refunded)";
export const RETURNED_SEARCH = "(return_status:return_requested OR return_status:in_progress OR return_status:inspection_complete OR return_status:returned)";

/** The orders search: these orders, created in the window (`YYYY-MM-DD`), updated since `since`. */
export function returnsSearch(filter, windowStart, since) {
  return `${filter} AND created_at:>='${windowStart}' AND updated_at:>='${since}'`;
}

/** Returns that didn't happen: declined by the merchant or cancelled. */
const NOT_RETURNED = new Set(["DECLINED", "CANCELED"]);

/** A refund of shipped goods: anything but a cancellation of an unshipped item (restock type CANCEL). */
const isReturn = (restockType) => String(restockType ?? "").toUpperCase() !== "CANCEL";

/** Refunded units and money per order line, from `[{ lineGid, productGid, quantity, restockType, amount }]`. */
function sumRefunds(orderGid, date, updatedAt, items) {
  const lines = new Map();
  for (const it of items) {
    if (!it.lineGid || !it.productGid || !isReturn(it.restockType)) continue;
    const quantity = Math.max(0, num(it.quantity) ?? 0);
    const line = lines.get(it.lineGid) ?? { lineGid: it.lineGid, orderGid, productGid: it.productGid, date, returnedQty: 0, refundedAmount: 0, orderUpdatedAt: updatedAt };
    line.returnedQty += quantity;
    line.refundedAmount = round2(line.refundedAmount + Math.max(0, num(it.amount) ?? 0));
    lines.set(it.lineGid, line);
  }
  return [...lines.values()].filter((l) => l.returnedQty > 0);
}

/**
 * Refunded (returned) units and the money refunded for them, per line of one order from the GraphQL
 * Admin API (`refunds { refundLineItems { nodes { quantity restockType subtotalSet lineItem { id product { id } } } } }`).
 * Cancellations of unshipped items aren't returns and are left out. Dates are the order's, in the store's calendar.
 */
export function lineRefundsFromOrder(order, timeZone) {
  if (!isType(order?.id, "Order") || typeof order.createdAt !== "string") return [];
  const items = (order.refunds ?? []).flatMap((r) =>
    (r?.refundLineItems?.nodes ?? []).map((n) => ({
      lineGid: n?.lineItem?.id,
      productGid: n?.lineItem?.product?.id,
      quantity: n?.quantity,
      restockType: n?.restockType,
      amount: n?.subtotalSet?.shopMoney?.amount,
    })),
  );
  return sumRefunds(order.id, localDateKey(new Date(order.createdAt), timeZone), new Date(order.updatedAt ?? order.createdAt), items);
}

/** The same from an order webhook (REST payload with `refunds` and `line_items`). */
export function lineRefundsFromWebhook(order, timeZone) {
  const orderGid = order?.admin_graphql_api_id ?? (order?.id ? `gid://shopify/Order/${order.id}` : null);
  if (!orderGid || !order.created_at) return [];
  const productOf = new Map((order.line_items ?? []).map((li) => [String(li.id), li.product_id]));
  const items = (order.refunds ?? []).flatMap((r) =>
    (r?.refund_line_items ?? []).map((rli) => {
      const lineId = rli.line_item_id ?? rli.line_item?.id;
      const productId = rli.line_item?.product_id ?? productOf.get(String(lineId));
      return {
        lineGid: rli.line_item?.admin_graphql_api_id ?? (lineId ? `gid://shopify/LineItem/${lineId}` : null),
        productGid: productId ? `gid://shopify/Product/${productId}` : null,
        quantity: rli.quantity,
        restockType: rli.restock_type,
        amount: rli.subtotal_set?.shop_money?.amount ?? rli.subtotal,
      };
    }),
  );
  return sumRefunds(orderGid, localDateKey(new Date(order.created_at), timeZone), new Date(order.updated_at ?? order.created_at), items);
}

/** Shopify's older return reasons (before reason definitions), as handle and name. */
const OLD_REASONS = {
  COLOR: ["color", "Color"],
  DEFECTIVE: ["damaged", "Damaged or defective"],
  NOT_AS_DESCRIBED: ["not-as-described", "Item not as described"],
  OTHER: ["other", "Other"],
  SIZE_TOO_LARGE: ["too-big", "Size was too large"],
  SIZE_TOO_SMALL: ["too-small", "Size was too small"],
  STYLE: ["style", "Style"],
  UNKNOWN: ["unknown", "Unknown"],
  UNWANTED: ["unwanted", "Customer changed their mind"],
  WRONG_ITEM: ["wrong-item", "Received the wrong item"],
};

/**
 * Why items of one order were returned, from the GraphQL Admin API (`returns { returnLineItems { … on
 * ReturnLineItem { id quantity returnReason returnReasonDefinition { handle name } fulfillmentLineItem
 * { lineItem { id product { id } } } } } }`). One row per return line; unverified lines, and returns that
 * were declined or cancelled, are skipped.
 */
export function returnReasonsFromOrder(order, timeZone) {
  if (!isType(order?.id, "Order") || typeof order.createdAt !== "string") return [];
  const date = localDateKey(new Date(order.createdAt), timeZone);
  const updatedAt = new Date(order.updatedAt ?? order.createdAt);
  return (order.returns?.nodes ?? []).filter((ret) => !NOT_RETURNED.has(ret?.status)).flatMap((ret) =>
    (ret?.returnLineItems?.nodes ?? []).flatMap((n) => {
      const lineItem = n?.fulfillmentLineItem?.lineItem;
      if (!n?.id || !lineItem?.id || !lineItem.product?.id) return [];
      const old = OLD_REASONS[n.returnReason] ?? OLD_REASONS.UNKNOWN;
      const definition = n.returnReasonDefinition;
      return [
        {
          returnLineGid: n.id,
          orderGid: order.id,
          lineGid: lineItem.id,
          productGid: lineItem.product.id,
          date,
          quantity: Math.max(0, num(n.quantity) ?? 0),
          reason: str(definition?.handle) ?? old[0],
          reasonName: str(definition?.name) ?? old[1],
          orderUpdatedAt: updatedAt,
        },
      ];
    }),
  );
}
