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
      const unitCost = (row.inventoryItem as { unitCost?: { amount?: unknown } | null } | undefined)?.unitCost?.amount;
      product.variants.push({
        gid: row.id!,
        sku: str(row.sku),
        options,
        price: num(row.price) ?? 0,
        cost: num(unitCost),
        inventoryQty: num(row.inventoryQuantity) ?? 0,
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

export type DailySales = { productGid: string; date: string; units: number; revenue: number };

/**
 * Orders JSONL (orders + child line items) → units and revenue per product per local day.
 * Only date, product, quantity and price are read; no customer data is requested or kept.
 */
export function aggregateOrders(rows: Row[], timeZone: string | null): DailySales[] {
  const orderDates = new Map<string, string>();
  for (const row of rows) {
    // Cancelled orders don't count as sales.
    if (isType(row.id, "Order") && typeof row.createdAt === "string" && !row.cancelledAt) {
      orderDates.set(row.id!, localDateKey(new Date(row.createdAt), timeZone));
    }
  }

  const totals = new Map<string, DailySales>();
  for (const row of rows) {
    if (!row.__parentId || !isType(row.id, "LineItem")) continue;
    const date = orderDates.get(row.__parentId);
    const productGid = (row.product as { id?: string } | null | undefined)?.id;
    if (!date || !productGid) continue; // deleted product or unknown order
    const quantity = num(row.quantity) ?? 0;
    const revenue = num((row.discountedTotalSet as { shopMoney?: { amount?: unknown } } | undefined)?.shopMoney?.amount) ?? 0;
    const key = `${productGid}|${date}`;
    const entry = totals.get(key) ?? { productGid, date, units: 0, revenue: 0 };
    entry.units += quantity;
    entry.revenue = Math.round((entry.revenue + revenue) * 100) / 100;
    totals.set(key, entry);
  }
  return [...totals.values()];
}
