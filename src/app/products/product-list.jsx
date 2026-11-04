"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { apiError } from "@/app/api-error";
import { BTN, CARD, Pill } from "@/app/ui/kit";
import { changeLabel } from "@/lib/product-list";
import { formatDays, moneyFormatter, STATUS_INFO } from "@/lib/status-info";

/** The filter pills, in the design's order ("Rising stars" is a filter of its own, not a status). */
const FILTERS = [
  { key: "dead_stock" },
  { key: "slow_mover" },
  { key: "page_problem" },
  { key: "hidden_gem" },
  { key: "stockout_risk" },
  { key: "new" },
  { key: "healthy" },
  { key: "rising", label: "Rising stars" },
  { key: "seasonal" },
  { key: "excluded", label: "Not analyzed" },
  { key: "unscored", label: "Not analyzed yet" },
  { key: "over_limit", label: "Over plan limit" },
];
const STATUSES = FILTERS.map((f) => f.key).filter((k) => k !== "rising");
const SORTS = {
  money: { label: "Money at stake", compare: (a, b) => b.moneyAtStake - a.moneyAtStake || b.stockValue - a.stockValue },
  value: { label: "Stock value", compare: (a, b) => b.stockValue - a.stockValue },
  days: { label: "Days of stock", compare: (a, b) => (a.daysOfCover ?? Infinity) - (b.daysOfCover ?? Infinity) },
  market: { label: "Price vs market", compare: (a, b) => (b.marketGap ?? -Infinity) - (a.marketGap ?? -Infinity) },
};
const pct = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 0 });

/** "+18%" above the market price, "−5%" below, "0%" within half a percent. */
function formatGap(gap) {
  if (Math.abs(gap) < 0.005) return "0%";
  return `${gap > 0 ? "+" : "−"}${Math.round(Math.abs(gap) * 100)}%`;
}

/** Days of stock: with stock but no sales in 30 days it lasts "over a year"; without stock, or off season, "—". */
const daysLabel = (p) =>
  p.status === "seasonal" ? "—" : p.daysOfCover != null ? formatDays(p.daysOfCover) : p.stockValue > 0 && p.status !== "unscored" ? "over a year" : "—";

const PILL = "cursor-pointer rounded-full px-2.5 py-1.5 text-[13px] font-semibold";

/** Every product with its status; filter by status (the dashboard tiles link here), search and sort. */
export function ProductList() {
  const router = useRouter();
  const params = useSearchParams();
  const risingOnly = params.get("rising") === "1";
  const status = !risingOnly && STATUSES.includes(params.get("status")) ? params.get("status") : null;
  const defaultSort = status === "stockout_risk" ? "days" : "money";
  const sort = SORTS[params.get("sort")] ? params.get("sort") : defaultSort;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/products")
      .then(async (res) => (res.ok ? setData(await res.json()) : Promise.reject(await apiError(res))))
      .catch((e) => setError(e.message));
  }, []);

  /** One filter at a time, as in the design: a status, "Rising stars", or all. */
  const go = (next) => {
    const q = new URLSearchParams();
    const filter = next.filter !== undefined ? next.filter : risingOnly ? "rising" : status;
    if (filter === "rising") q.set("rising", "1");
    else if (filter) q.set("status", filter);
    q.set("sort", next.sort ?? sort);
    router.replace(`/products?${q}`);
  };
  const money = moneyFormatter(data?.currency);
  const products = data?.products ?? [];
  // The market column (and its sort) appears once any product has a comparable market price.
  const hasMarket = products.some((p) => p.marketGap != null);
  const sortBy = sort === "market" && !hasMarket ? defaultSort : sort;
  const needle = query.trim().toLowerCase();
  const shown = products
    .filter((p) => (risingOnly ? p.rising : !status || p.status === status) && (!needle || p.title.toLowerCase().includes(needle)))
    .sort(SORTS[sortBy].compare);
  const countOf = (key) => (key === "rising" ? products.filter((p) => p.rising).length : products.filter((p) => p.status === key).length);
  const unscored = countOf("unscored");
  const current = risingOnly ? "rising" : status;

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-[22px] font-bold tracking-[-0.01em]">Products</h1>
          <p className="mt-0.5 mb-0 text-[13px] text-muted">Every active product with its status, money at stake{hasMarket ? " and market price" : ""}.</p>
        </div>
        <Link href="/compare" className={BTN.secondary}>
          Compare products
        </Link>
      </header>

      {error && <p className="m-0 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-5 py-4 text-[#B91C1C]">Could not load products ({error}).</p>}
      {!data && !error && <p className="m-0 text-muted">Loading products…</p>}
      {data && (
        <section aria-label="Product list" className={`${CARD} overflow-hidden`}>
          <div className="flex flex-col gap-3 border-b border-hair px-4 py-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="q" className="sr-only">
                Search products
              </label>
              <input
                id="q"
                type="search"
                placeholder="Search products"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="min-w-0 flex-[1_1_260px] rounded-lg border border-line-strong px-3 py-[9px] font-[inherit]"
              />
              <label htmlFor="sort" className="text-[13px] text-muted">
                Sort
              </label>
              <select id="sort" value={sortBy} onChange={(e) => go({ sort: e.target.value })} className="rounded-lg border border-line-strong bg-white px-2.5 py-[9px] font-[inherit]">
                {Object.entries(SORTS)
                  .filter(([key]) => key !== "market" || hasMarket)
                  .map(([key, s]) => (
                    <option key={key} value={key}>
                      {s.label}
                    </option>
                  ))}
              </select>
            </div>
            <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1.5">
              <button
                type="button"
                aria-pressed={!current}
                onClick={() => go({ filter: "" })}
                className={`${PILL} ${!current ? "border border-ink bg-ink text-white" : "border border-line-strong bg-white text-ink-2"}`}
              >
                All <span className="tabular-nums opacity-75">{products.length}</span>
              </button>
              {FILTERS.filter((f) => countOf(f.key) > 0 || f.key === current).map((f) => (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={current === f.key}
                  onClick={() => go({ filter: f.key })}
                  className={`${PILL} ${current === f.key ? "border border-ink bg-ink text-white" : "border border-line-strong bg-white text-ink-2"}`}
                >
                  {f.label ?? STATUS_INFO[f.key]?.label ?? f.key} <span className="tabular-nums opacity-75">{countOf(f.key)}</span>
                </button>
              ))}
            </div>
            {risingOnly && <p className="m-0 text-[13px] text-muted">Rising stars: sales up 20% or more over the 30 days before. Give them more visibility and keep them in stock.</p>}
            {status && STATUS_INFO[status] && (
              <p className="m-0 text-[13px] text-muted">
                Next for {STATUS_INFO[status].label.toLowerCase()}: {STATUS_INFO[status].action}.
              </p>
            )}
          </div>
          {shown.length === 0 ? (
            <p className="m-0 px-4 py-4 text-[13px] text-muted">{needle ? "No product matches your search." : "No products here."}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-[13px]">
                <thead>
                  <tr className="bg-head text-left whitespace-nowrap text-muted">
                    <th scope="col" className="py-[9px] pr-3 pl-4 font-semibold">
                      Product
                    </th>
                    <th scope="col" className="px-3 py-[9px] font-semibold">
                      Status
                    </th>
                    <th scope="col" className="px-3 py-[9px] text-right font-semibold">
                      Money at stake
                    </th>
                    <th scope="col" className="px-3 py-[9px] text-right font-semibold">
                      Stock value
                    </th>
                    <th scope="col" className="px-3 py-[9px] text-right font-semibold">
                      Days of stock
                    </th>
                    <th scope="col" className="px-3 py-[9px] text-right font-semibold">
                      Sell-through
                    </th>
                    {hasMarket && (
                      <th scope="col" className="px-3 py-[9px] text-right font-semibold">
                        vs market
                      </th>
                    )}
                    <th scope="col" className="py-[9px] pr-4 pl-3 font-semibold">
                      Last change
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => (
                    <tr key={p.productId} className="border-t border-hair">
                      <td className="py-2.5 pr-3 pl-4">
                        <span className="flex items-center gap-2.5">
                          <span aria-hidden="true" className="h-[34px] w-[34px] flex-none rounded-[7px] bg-[#E9EBEF]" />
                          <Link href={`/products/${p.productId}`} className="font-semibold text-ink no-underline hover:text-ink hover:underline">
                            {p.title}
                          </Link>
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="flex flex-wrap gap-1">
                          <Pill tone={p.status}>{STATUS_INFO[p.status]?.label ?? p.status}</Pill>
                          {p.rising && <Pill tone="rising">Rising star</Pill>}
                          {p.markdown && <Pill tone="neutral">{p.markdown.paused ? "Markdown · paused" : `Markdown · step ${p.markdown.step}`}</Pill>}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{p.moneyAtStake > 0 ? money.format(p.moneyAtStake) : "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{p.status === "unscored" ? "—" : money.format(p.stockValue)}</td>
                      <td className="px-3 py-2.5 text-right text-ink-2 tabular-nums">{daysLabel(p)}</td>
                      <td className="px-3 py-2.5 text-right text-ink-2 tabular-nums">{p.sellThrough == null ? "—" : pct.format(p.sellThrough)}</td>
                      {hasMarket && (
                        <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${p.marketGap > 0 ? "text-[#B45309]" : "text-ink-2"}`}>
                          {p.marketGap == null ? "—" : formatGap(p.marketGap)}
                        </td>
                      )}
                      <td className="py-2.5 pr-4 pl-3 text-muted">{changeLabel(p.lastChange)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(hasMarket || unscored > 0) && (
            <p className="m-0 border-t border-hair px-4 pt-2.5 pb-3.5 text-xs text-muted">
              {hasMarket ? `"vs market" compares your price with Google Shopping's benchmark and your competitor links.` : ""}
              {hasMarket && unscored > 0 ? " " : ""}
              {unscored > 0 ? `${unscored} product${unscored === 1 ? " is" : "s are"} not analyzed yet (added after last night's run).` : ""}
            </p>
          )}
        </section>
      )}
    </>
  );
}
