// Turns bulk-operation JSONL rows into records we store. Pure, relative imports only, so node:test can load it.
import { localDateKey } from "../jobs/schedule.ts";

type Row = Record<string, unknown> & { id?: string; __parentId?: string };

export type VariantRecord = {
  gid: string;
  sku: string | null;
  options: Record<string, string>;
  price: number;
  cost: number | null;
  inventoryQty: number;
  /** Untracked inventory or "continue selling when out of stock". */
  sellsWhenOut: boolean;
};

export type ProductRecord = {
  gid: string;
  title: string;
  handle: string;
  productType: string | null;
  vendor: string | null;
  status: string;
  createdAt: Date | null;
  descriptionWords: number;
  description: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  imageCount: number;
  /** Lowest variant price; compare-at of that variant. */
  price: number;
  compareAtPrice: number | null;
  collections: string[];
  variants: VariantRecord[];
};

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

export function wordCount(text: string | null | undefined): number {
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

const isType = (id: unknown, type: string) => typeof id === "string" && id.startsWith(`gid://shopify/${type}/`);

/** Products JSONL (products + child collections + child variants) → product records. */
export function assembleProducts(rows: Row[]): ProductRecord[] {
  const products = new Map<string, ProductRecord>();
  const children: Row[] = [];

  for (const row of rows) {
    if (isType(row.id, "Product") && !row.__parentId) {
      products.set(row.id!, {
        gid: row.id!,
        title: str(row.title) ?? "",
        handle: str(row.handle) ?? "",
        productType: str(row.productType),
        vendor: str(row.vendor),
        status: str(row.status) ?? "ACTIVE",
        createdAt: typeof row.createdAt === "string" ? new Date(row.createdAt) : null,
        descriptionWords: wordCount(str(row.description)),
        description: str(row.description)?.slice(0, 5000) ?? null,
        seoTitle: str((row.seo as { title?: unknown } | null | undefined)?.title),
        seoDescription: str((row.seo as { description?: unknown } | null | undefined)?.description),
        imageCount: num((row.mediaCount as { count?: unknown } | undefined)?.count) ?? 0,
        price: 0,
        compareAtPrice: null,
        collections: [],
        variants: [],
      });
    } else if (row.__parentId) {
      children.push(row);
    }
  }

  const compareAt = new Map<string, number | null>();
  for (const row of children) {
    const product = products.get(row.__parentId!);
    if (!product) continue;
    if (isType(row.id, "Collection")) {
      product.collections.push(row.id!);
    } else if (isType(row.id, "ProductVariant")) {
      const options = Object.fromEntries(
        ((row.selectedOptions as { name: string; value: string }[] | undefined) ?? []).map((o) => [o.name, o.value]),
      );
      const item = row.inventoryItem as { unitCost?: { amount?: unknown } | null; tracked?: boolean } | undefined;
      const unitCost = item?.unitCost?.amount;
      product.variants.push({
        gid: row.id!,
        sku: str(row.sku),
        options,
        price: num(row.price) ?? 0,
        cost: num(unitCost),
        inventoryQty: num(row.inventoryQuantity) ?? 0,
        sellsWhenOut: item?.tracked === false || row.inventoryPolicy === "CONTINUE",
      });
      compareAt.set(row.id!, num(row.compareAtPrice));
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

export type OrderLineRecord = {
  lineGid: string;
  orderGid: string;
  productGid: string;
  variantGid: string | null;
  /** Local date (YYYY-MM-DD) in the store's timezone. */
  date: string;
  /** Quantity after removals/refunds; 0 for cancelled orders (kept so stale webhooks can be detected). */
  quantity: number;
  /** Revenue after line and order-level discounts. */
  revenue: number;
  orderUpdatedAt: Date;
};

const money = (v: unknown) => num((v as { shopMoney?: { amount?: unknown } } | undefined)?.shopMoney?.amount) ?? 0;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Orders JSONL (orders + child line items) → order lines. Only date, cancellation, product, variant,
 * quantity and price are read; no customer data is requested or kept. Lines of deleted products are skipped.
 */
export function orderLinesFromBulk(rows: Row[], timeZone: string | null): OrderLineRecord[] {
  const orders = new Map<string, { date: string; cancelled: boolean; updatedAt: Date }>();
  for (const row of rows) {
    if (isType(row.id, "Order") && typeof row.createdAt === "string") {
      orders.set(row.id!, {
        date: localDateKey(new Date(row.createdAt), timeZone),
        cancelled: Boolean(row.cancelledAt),
        updatedAt: new Date(typeof row.updatedAt === "string" ? row.updatedAt : row.createdAt),
      });
    }
  }
  const lines: OrderLineRecord[] = [];
  for (const row of rows) {
    if (!row.__parentId || !isType(row.id, "LineItem")) continue;
    const order = orders.get(row.__parentId);
    const productGid = (row.product as { id?: string } | null | undefined)?.id;
    if (!order || !productGid) continue;
    const quantity = order.cancelled ? 0 : Math.max(0, num(row.currentQuantity) ?? 0);
    lines.push({
      lineGid: row.id!,
      orderGid: row.__parentId,
      productGid,
      variantGid: (row.variant as { id?: string } | null | undefined)?.id ?? null,
      date: order.date,
      quantity,
      revenue: round2(quantity * money(row.discountedUnitPriceAfterAllDiscountsSet)),
      orderUpdatedAt: order.updatedAt,
    });
  }
  return lines;
}

type WebhookLineItem = {
  admin_graphql_api_id?: string;
  id?: number;
  product_id?: number | null;
  variant_id?: number | null;
  quantity?: number;
  current_quantity?: number;
  price?: string;
  discount_allocations?: { amount?: string }[];
};

export type OrderWebhook = {
  admin_graphql_api_id?: string;
  id?: number;
  created_at?: string;
  updated_at?: string;
  cancelled_at?: string | null;
  line_items?: WebhookLineItem[];
};

/**
 * orders/create|updated|cancelled webhook payload (REST shape) → order lines, same rules as the bulk
 * import. Revenue: (price × quantity − discount allocations), scaled to the current quantity.
 */
export function orderLinesFromWebhook(order: OrderWebhook, timeZone: string | null): OrderLineRecord[] {
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

type ProductNode = Row & {
  collections?: { nodes?: { id: string }[] };
  variants?: { nodes?: Row[] };
};

/** Single-product GraphQL result → the same row shape as bulk JSONL, for `assembleProducts`. */
export function rowsFromProductNode(node: ProductNode): Row[] {
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
  const parse = (lines: string[]) => lines.filter((l) => l.trim()).map((l) => JSON.parse(l) as Record<string, unknown>);
  return {
    push(text: string) {
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
