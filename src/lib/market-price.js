// Market price from competitor links (and, later, Google Shopping). Pure (relative imports only) so
// node:test can load it.

import { median } from "./diagnosis.js";

export { gapToMarket } from "./diagnosis.js";

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * The competitors' price for a product: the median of links read successfully in the shop's currency.
 * Links in another currency or without one are counted but never compared.
 */
export function competitorSummary(links, currency) {
  const ok = links.filter((l) => l.status === "ok" && Number(l.price) > 0);
  const same = ok.filter((l) => currency && l.currency === currency);
  const med = median(same.map((l) => Number(l.price)));
  return {
    median: med == null ? null : round2(med),
    count: same.length,
    otherCurrency: ok.filter((l) => l.currency && l.currency !== currency).length,
    unknownCurrency: ok.filter((l) => !l.currency).length,
  };
}

