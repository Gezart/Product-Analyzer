"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { apiError } from "@/app/api-error";
import { listen } from "@/app/polaris-events";
import { formatDays, moneyFormatter, STATUS_INFO } from "@/lib/status-info";

const STATUSES = ["dead_stock", "slow_mover", "page_problem", "hidden_gem", "stockout_risk", "healthy", "new", "seasonal", "excluded", "over_limit", "unscored"];
const SORTS = {
  money: { label: "Money at stake", compare: (a, b) => b.moneyAtStake - a.moneyAtStake || b.stockValue - a.stockValue },
  days: { label: "Fewest days of stock", compare: (a, b) => (a.daysOfCover ?? Infinity) - (b.daysOfCover ?? Infinity) },
  market: { label: "Most above market", compare: (a, b) => (b.marketGap ?? -Infinity) - (a.marketGap ?? -Infinity) },
  title: { label: "Name", compare: (a, b) => a.title.localeCompare(b.title) },
};

/** "+18%" above the market price, "−5%" below, "same" within half a percent. */
function formatGap(gap) {
  if (Math.abs(gap) < 0.005) return "same";
  return `${gap > 0 ? "+" : "−"}${Math.round(Math.abs(gap) * 100)}%`;
}

/** Every product with its status; filter by status (the dashboard tiles link here) and sort. */
export function ProductList() {
  const router = useRouter();
  const params = useSearchParams();
  const status = STATUSES.includes(params.get("status")) ? params.get("status") : null;
  const risingOnly = params.get("rising") === "1";
  const defaultSort = status === "stockout_risk" ? "days" : "money";
  const sort = SORTS[params.get("sort")] ? params.get("sort") : defaultSort;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/products")
      .then(async (res) => (res.ok ? setData(await res.json()) : Promise.reject(await apiError(res))))
      .catch((e) => setError(e.message));
  }, []);

  const go = (next) => {
    const q = new URLSearchParams();
    const nextStatus = next.status !== undefined ? next.status : status;
    if (nextStatus) q.set("status", nextStatus);
    if (next.rising ?? (next.status === undefined && risingOnly)) q.set("rising", "1");
    q.set("sort", next.sort ?? sort);
    router.replace(`/products?${q}`);
  };
  const money = moneyFormatter(data?.currency);
  // The market column (and its sort) appears once any product has a comparable competitor price.
  const hasMarket = (data?.products ?? []).some((p) => p.marketGap != null);
  const sortBy = sort === "market" && !hasMarket ? defaultSort : sort;
  const shown = (data?.products ?? []).filter((p) => (!status || p.status === status) && (!risingOnly || p.rising)).sort(SORTS[sortBy].compare);
  const risingCount = (data?.products ?? []).filter((p) => p.rising).length;
  const counts = Object.fromEntries(STATUSES.map((s) => [s, (data?.products ?? []).filter((p) => p.status === s).length]));

  return (
    <s-page heading="Products">
      <s-stack gap="base">
        <div>
          <Link href="/" className="text-sm text-zinc-600 hover:underline">
            ← Catalog health
          </Link>
        </div>
        {error && <s-banner tone="critical">Could not load products ({error}).</s-banner>}
        {!data && !error && <s-spinner accessibilityLabel="Loading products" />}
        {data && (
          <>
            <div className="flex flex-wrap gap-2">
              <s-button variant={status || risingOnly ? "tertiary" : "secondary"} ref={listen("click", () => go({ status: "", rising: false }))}>
                All ({data.products.length})
              </s-button>
              {STATUSES.filter((s) => counts[s] > 0).map((s) => (
                <s-button key={s} variant={status === s ? "secondary" : "tertiary"} ref={listen("click", () => go({ status: s }))}>
                  {STATUS_INFO[s].label} ({counts[s]})
                </s-button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-600">
              Sort by
              {Object.entries(SORTS).filter(([key]) => key !== "market" || hasMarket).map(([key, s]) => (
                <button key={key} type="button" onClick={() => go({ sort: key })} className={key === sortBy ? "font-semibold text-zinc-900" : "hover:underline"}>
                  {s.label}
                </button>
              ))}
            </div>
            {(risingCount > 0 || risingOnly) && (
              <div>
                <s-button variant={risingOnly ? "secondary" : "tertiary"} ref={listen("click", () => go({ status: "", rising: !risingOnly }))}>
                  ↑ Rising stars ({risingCount})
                </s-button>
              </div>
            )}
            {risingOnly && <s-text tone="neutral">Rising stars: sales up 20% or more over the 30 days before. Give them more visibility and keep them in stock.</s-text>}
            {status && <s-text tone="neutral">Next for {STATUS_INFO[status].label.toLowerCase()}: {STATUS_INFO[status].action}.</s-text>}
            <s-section>
              {shown.length === 0 ? (
                <s-paragraph>No products here.</s-paragraph>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-zinc-500">
                      <tr>
                        <th className="py-2 pr-4 font-medium">Product</th>
                        <th className="py-2 pr-4 font-medium">Status</th>
                        <th className="py-2 pr-4 text-right font-medium">Money at stake</th>
                        <th className="hidden py-2 pr-4 text-right font-medium sm:table-cell">Stock value</th>
                        <th className="py-2 text-right font-medium">Days of stock</th>
                        {hasMarket && <th className="py-2 pl-4 text-right font-medium">vs market</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((p) => (
                        <tr key={p.productId} className="border-t border-zinc-200">
                          <td className="py-2 pr-4">
                            <Link href={`/products/${p.productId}`} className="font-medium hover:underline">
                              {p.title}
                            </Link>
                          </td>
                          <td className="py-2 pr-4">
                            <s-badge tone={STATUS_INFO[p.status]?.tone}>{STATUS_INFO[p.status]?.label ?? p.status}</s-badge>
                            {p.rising && <span className="ml-1 text-xs font-medium text-emerald-700">↑ Rising</span>}
                          </td>
                          <td className="py-2 pr-4 text-right">{p.moneyAtStake > 0 ? money.format(p.moneyAtStake) : "—"}</td>
                          <td className="hidden py-2 pr-4 text-right sm:table-cell">{p.status === "unscored" ? "—" : money.format(p.stockValue)}</td>
                          <td className="py-2 text-right">{formatDays(p.daysOfCover)}</td>
                          {hasMarket && (
                            <td className={`py-2 pl-4 text-right ${p.marketGap > data.marketAbove ? "font-medium text-orange-800" : ""}`}>
                              {p.marketGap == null ? "—" : formatGap(p.marketGap)}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </s-section>
          </>
        )}
      </s-stack>
    </s-page>
  );
}
