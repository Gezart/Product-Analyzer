// A month's returns from the database sums. Pure (no imports) so node:test can load it.

/**
 * `kept`: units kept from the month's orders; `returned`/`refunded`: units back and money refunded;
 * `byProduct`: `[{ productGid, returned, refunded }]` (most refunded first); `keptByProduct`: productGid → units kept;
 * `products`: productGid → `{ id, title }`; `reasons`: `[{ handle, count }]`; `names`: handle → latest name.
 */
export function summarizeReturns({ kept, returned, refunded, byProduct = [], keptByProduct = new Map(), products = new Map(), reasons = [], names = new Map() }) {
  const sold = kept + returned;
  return {
    refunded: Math.round(refunded * 100) / 100,
    returned,
    sold,
    rate: sold > 0 ? returned / sold : null,
    reasons: reasons.filter((r) => r.count > 0).map((r) => ({ handle: r.handle, name: names.get(r.handle) ?? r.handle, count: r.count })),
    products: byProduct
      .filter((r) => r.returned > 0)
      .map((r) => {
        const units = (keptByProduct.get(r.productGid) ?? 0) + r.returned;
        const p = products.get(r.productGid);
        return {
          productGid: r.productGid,
          productId: p?.id ?? null,
          title: p?.title ?? "Deleted product",
          returned: r.returned,
          sold: units,
          rate: units > 0 ? r.returned / units : null,
          refunded: Math.round(r.refunded * 100) / 100,
        };
      }),
  };
}
