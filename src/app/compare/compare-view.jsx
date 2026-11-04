"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BTN, CARD, Notice, PageHeader, Pill, UpgradeNotice } from "@/app/ui/kit";
import { bestIndex, MAX_COMPARE } from "@/lib/compare";
import { FEATURE_PLAN, getPlan, hasFeature } from "@/lib/plans";
import { moneyFormatter, STATUS_INFO } from "@/lib/status-info";

const pct = (n) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);
const pct0 = (n) => `${Math.round(n * 100)}%`;
/** "+18%" above the market, "−2%" below, "0%" within half a percent. */
const gapLabel = (gap) => (Math.abs(gap) < 0.005 ? "0%" : `${gap > 0 ? "+" : "−"}${Math.round(Math.abs(gap) * 100)}%`);
const PERIODS = [30, 60, 90];
const TOGGLE = (on) =>
  `cursor-pointer rounded-[7px] border px-2.5 py-[5px] font-[inherit] text-[13px] font-semibold disabled:cursor-default disabled:opacity-50 ${on ? "border-ink bg-ink text-white" : "border-line-strong bg-white text-ink"}`;

/** 2–4 products side by side (the owner's design); the picked products and the window live in the URL. */
export function CompareView() {
  const router = useRouter();
  const params = useSearchParams();
  const ids = params.get("ids") ?? "";
  const days = params.get("days") ?? "30";
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [upgrade, setUpgrade] = useState(null);

  // Tell a shop without the feature before it picks anything.
  useEffect(() => {
    fetch("/api/shop")
      .then((res) => (res.ok ? res.json() : null))
      .then((shop) => {
        if (shop && !hasFeature(shop.plan, "compare")) setUpgrade(`Compare is included from the ${getPlan(FEATURE_PLAN.compare).name} plan.`);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!ids) return;
    let live = true;
    setData(null);
    setError(null);
    fetch(`/api/compare?ids=${encodeURIComponent(ids)}&days=${days}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (res.status === 403 && body.upgrade) return live && setUpgrade(body.error);
        if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`);
        if (live) setData(body);
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [ids, days]);

  const show = (nextIds, nextDays = days) => router.replace(nextIds.length ? `/compare?ids=${nextIds.join(",")}&days=${nextDays}` : `/compare?days=${nextDays}`);
  const products = ids && data ? data.products : [];

  async function pick() {
    if (!window.shopify) return;
    const picked = await window.shopify.resourcePicker({
      type: "product",
      multiple: MAX_COMPARE,
      action: "select",
      selectionIds: products.map((p) => ({ id: p.shopifyGid })),
    });
    if (picked?.length) show(picked.map((p) => p.id));
  }

  const money = moneyFormatter(data?.currency ?? "USD");
  const money2 = moneyFormatter(data?.currency ?? "USD", 2);
  const sold = (p) => (p.stockAge.sold ? p.stockAge.days : null);
  const rows = [
    { label: "Units sold", best: bestIndex(products.map((p) => p.units)), show: (p) => p.units.toLocaleString() },
    { label: "Revenue", best: bestIndex(products.map((p) => p.revenue)), show: (p) => money.format(p.revenue) },
    { label: "Views", best: bestIndex(products.map((p) => p.views)), show: (p) => p.views.toLocaleString() },
    { label: "Conversion", best: bestIndex(products.map((p) => p.conversion)), show: (p) => pct(p.conversion) },
    {
      label: "Price vs market",
      // The price nearest below (or least above) the market is the best.
      best: bestIndex(products.map((p) => p.marketGap), true),
      show: (p) =>
        `${money2.format(p.price)}${p.marketGap != null ? ` · ${gapLabel(p.marketGap)}` : ""}${p.compareAtPrice ? ` (was ${money2.format(p.compareAtPrice)})` : ""}`,
    },
    {
      label: "Margin",
      best: bestIndex(products.map((p) => p.margin)),
      show: (p) => (p.margin == null ? "— (no unit cost)" : pct0(p.margin)),
      note: (p) => (p.margin != null && p.withCost < p.variants ? `${p.withCost} of ${p.variants} variants have a cost` : null),
    },
    {
      label: "In stock",
      // Everything can be bought, with the most stock.
      best: bestIndex(products.map((p) => (p.outOfStock.length === 0 ? p.stock : null))),
      show: (p) =>
        `${p.stock.toLocaleString()} · ${
          p.outOfStock.length === 0 ? (p.variantCount > 1 ? "all variants" : "in stock") : p.variantCount === 1 ? "out of stock" : `${p.outOfStock.join(", ")} out`
        }`,
    },
    {
      label: "Stock value",
      // Less money tied up in stock.
      best: bestIndex(products.map((p) => p.stockValue), true),
      show: (p) => `${money.format(p.stockValue)}${p.stockValueIsEstimate ? " (est.)" : ""}`,
    },
    {
      label: "Days since last sale",
      // Products that never sold aren't "fresher" stock: they don't compete for best.
      best: bestIndex(products.map(sold), true),
      show: (p) => (p.stockAge.days == null ? "—" : `${p.stockAge.atLeast ? "over " : ""}${p.stockAge.days.toLocaleString()}${p.stockAge.sold ? "" : " (no sale yet)"}`),
    },
    {
      label: "Page quality",
      best: bestIndex(products.map((p) => p.pageQuality.score)),
      show: (p) => `${p.imageCount} photo${p.imageCount === 1 ? "" : "s"} · ${p.descriptionWords.toLocaleString()} words`,
      note: (p) => {
        const missing = p.pageQuality.checks.filter((c) => !c.ok).map((c) => c.label.toLowerCase());
        return missing.length ? `Missing: ${missing.join(", ")}` : "All page checks pass";
      },
    },
  ];

  const periods = (
    <div role="group" aria-label="Period" className="flex gap-1">
      {PERIODS.map((d) => (
        <button key={d} type="button" aria-pressed={String(d) === days} disabled={!ids || upgrade != null} onClick={() => show(ids.split(","), d)} className={TOGGLE(String(d) === days)}>
          {d} days
        </button>
      ))}
    </div>
  );

  return (
    <>
      <PageHeader title="Compare" subtitle="Why does one sell and the other not? The best value in each row is highlighted." actions={!upgrade && periods} />
      {upgrade && <UpgradeNotice>{upgrade}</UpgradeNotice>}
      {error && <Notice tone="bad">{error}</Notice>}
      {!ids && !upgrade && (
        <section className={`${CARD} flex flex-wrap items-center justify-between gap-3 px-5 py-[18px]`}>
          <p className="m-0 text-[13px] text-muted">Pick 2 to {MAX_COMPARE} products to see them side by side: sales, views, price against the market, stock and page quality.</p>
          <button type="button" onClick={pick} className={`${BTN.primary} cursor-pointer`}>
            Pick products
          </button>
        </section>
      )}
      {ids && !data && !error && !upgrade && <p className="m-0 text-muted">Loading the comparison…</p>}
      {data?.notFound > 0 && (
        <Notice tone="warn" compact>
          {data.notFound} picked product{data.notFound === 1 ? " isn't" : "s aren't"} synced yet and {data.notFound === 1 ? "is" : "are"} left out.
        </Notice>
      )}
      {data && products.length === 1 && <Notice tone="info" compact>Add at least one more product to compare.</Notice>}
      {data?.partial && <Notice tone="warn" compact>Order history is shorter than {data.days} days, so sales are undercounted.</Notice>}

      {products.length > 0 && (
        <section aria-label="Comparison" className={`${CARD} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-[13px]">
              <thead>
                <tr className="align-bottom">
                  <th scope="col" className="w-[170px] px-5 pt-4 pb-3 text-left text-xs font-semibold text-muted">
                    Last {data.days} days
                  </th>
                  {products.map((p) => (
                    <th key={p.id} scope="col" className="min-w-[170px] px-3 pt-4 pb-3 text-left align-bottom font-normal">
                      <div aria-hidden="true" className="mb-2 h-12 w-12 rounded-lg bg-[#E9EBEF]" />
                      <Link href={`/products/${p.id}`} className="block font-semibold text-ink no-underline hover:text-ink hover:underline">
                        {p.title}
                      </Link>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5">
                        {p.scoreStatus && STATUS_INFO[p.scoreStatus] && <Pill tone={p.scoreStatus}>{STATUS_INFO[p.scoreStatus].label}</Pill>}
                        {p.status !== "ACTIVE" && <Pill tone="neutral">{p.status.toLowerCase()}</Pill>}
                        <button
                          type="button"
                          onClick={() => show(products.filter((q) => q.id !== p.id).map((q) => q.id))}
                          className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-xs font-semibold text-muted hover:text-ink"
                        >
                          Remove
                        </button>
                      </span>
                    </th>
                  ))}
                  <th scope="col" className="px-3 pt-4 pr-5 pb-3 text-left align-bottom">
                    {products.length < MAX_COMPARE && (
                      <button type="button" onClick={pick} className="cursor-pointer rounded-lg border border-dashed border-accent bg-white px-3 py-[7px] font-[inherit] text-[13px] font-semibold whitespace-nowrap text-accent">
                        + Add product
                      </button>
                    )}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label} className="border-t border-hair">
                    <th scope="row" className="px-5 py-2 text-left align-top font-semibold text-ink-2">
                      {r.label}
                    </th>
                    {products.map((p, i) => (
                      <td key={p.id} className="px-3 py-2 align-top">
                        <span className={`inline-block rounded-md px-2 py-1 tabular-nums ${i === r.best ? "bg-[#D1FAE5] font-bold text-[#065F46]" : ""}`}>{r.show(p)}</span>
                        {r.note?.(p) && <span className="block px-2 text-xs text-muted">{r.note(p)}</span>}
                      </td>
                    ))}
                    <td />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="m-0 border-t border-hair px-5 pt-2.5 pb-3.5 text-xs text-muted">
            {products.some((p) => p.views > 0) ? "" : "Views and conversion appear once view sync is connected. "}Margin uses the unit cost in Shopify; price vs market uses your
            competitor links and Google Shopping&apos;s benchmark; page quality counts the diagnosis&apos;s page checks.
          </p>
        </section>
      )}
    </>
  );
}
