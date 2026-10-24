"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { listen } from "@/app/polaris-events";
import { bestIndex, MAX_COMPARE } from "@/lib/compare";
import { moneyFormatter, STATUS_INFO } from "@/lib/status-info";

const pct = (n) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);

/** 2–4 products side by side; the picked products and the window live in the URL. */
export function CompareView() {
  const router = useRouter();
  const params = useSearchParams();
  const ids = params.get("ids") ?? "";
  const days = params.get("days") ?? "30";
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!ids) return;
    let live = true;
    setData(null);
    setError(null);
    fetch(`/api/compare?ids=${encodeURIComponent(ids)}&days=${days}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`);
        if (live) setData(body);
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [ids, days]);

  const show = (nextIds, nextDays = days) => router.replace(`/compare?ids=${nextIds.join(",")}&days=${nextDays}`);
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
  const rows = [
    { label: "Units sold", values: products.map((p) => p.units), show: (v) => v.toLocaleString() },
    { label: "Revenue", values: products.map((p) => p.revenue), show: (v) => money.format(v) },
    { label: "Views", values: products.map((p) => p.views), show: (v) => v.toLocaleString() },
    { label: "Conversion (view → purchase)", values: products.map((p) => p.conversion), show: pct },
    {
      label: "Price",
      values: products.map((p) => p.price),
      show: (v, p) => `${money2.format(v)}${p.compareAtPrice ? ` (was ${money2.format(p.compareAtPrice)})` : ""}`,
      noBest: true,
    },
    {
      label: "Margin",
      values: products.map((p) => p.margin),
      show: (v, p) => (v == null ? "— (no unit cost)" : `${pct(v)}${p.withCost < p.variants ? ` (${p.withCost} of ${p.variants} variants have a cost)` : ""}`),
    },
    { label: "In stock", values: products.map((p) => p.stock), show: (v) => v.toLocaleString(), noBest: true },
    {
      label: "Stock value",
      values: products.map((p) => p.stockValue),
      show: (v, p) => `${money.format(v)}${p.stockValueIsEstimate ? " (estimated)" : ""}`,
      noBest: true,
    },
    {
      label: "Stock age (days since last sale)",
      values: products.map((p) => p.stockAge.days),
      // Products that never sold aren't "fresher" stock: they don't compete for best.
      best: () => bestIndex(products.map((p) => (p.stockAge.sold ? p.stockAge.days : null)), true),
      show: (v, p) => (v == null ? "—" : `${p.stockAge.atLeast ? "over " : ""}${v} days${p.stockAge.sold ? "" : " (no sale yet)"}`),
    },
    { label: "Page quality", values: products.map((p) => p.pageQuality.score), show: (v) => `${v} / 100`, quality: true },
  ];

  return (
    <s-page heading="Compare products">
      <s-stack gap="base">
        <div>
          <Link href="/" className="text-sm text-zinc-600 hover:underline">
            ← Catalog health
          </Link>
        </div>
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-button variant="primary" ref={listen("click", pick)}>
            {products.length ? "Change products" : "Pick products"}
          </s-button>
          {[30, 60, 90].map((d) => (
            <s-button key={d} variant={String(d) === days ? "secondary" : "tertiary"} ref={listen("click", () => ids && show(ids.split(","), d))}>
              Last {d} days
            </s-button>
          ))}
        </s-stack>

        {error && <s-banner tone="critical">{error}</s-banner>}
        {!ids && <s-banner tone="info">Pick 2 to {MAX_COMPARE} products to see them side by side.</s-banner>}
        {ids && !data && !error && <s-spinner accessibilityLabel="Loading comparison" />}
        {data?.notFound > 0 && <s-banner tone="warning">{data.notFound} picked product(s) aren&apos;t synced yet and are left out.</s-banner>}
        {data && products.length === 1 && <s-banner tone="info">Pick at least one more product to compare.</s-banner>}
        {data?.partial && <s-banner tone="warning">Order history is shorter than {data.days} days, so sales are undercounted.</s-banner>}

        {products.length > 0 && (
          <s-section>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <th className="py-2 pr-4 font-medium text-zinc-500">Last {data.days} days</th>
                    {products.map((p) => (
                      <th key={p.id} className="min-w-40 py-2 pr-4 align-top font-medium">
                        <Link href={`/products/${p.id}`} className="hover:underline">
                          {p.title}
                        </Link>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          {p.scoreStatus && STATUS_INFO[p.scoreStatus] && <s-badge tone={STATUS_INFO[p.scoreStatus].tone}>{STATUS_INFO[p.scoreStatus].label}</s-badge>}
                          {p.status !== "ACTIVE" && <s-badge>{p.status.toLowerCase()}</s-badge>}
                          <button
                            type="button"
                            className="text-xs text-zinc-500 hover:underline"
                            onClick={() => show(products.filter((q) => q.id !== p.id).map((q) => q.id))}
                          >
                            Remove
                          </button>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const best = r.noBest ? null : r.best ? r.best() : bestIndex(r.values, r.lowerIsBetter);
                    return (
                      <tr key={r.label} className="border-t border-zinc-200">
                        <td className="py-2 pr-4 align-top text-zinc-600">{r.label}</td>
                        {products.map((p, i) => (
                          <td key={p.id} className={`py-2 pr-4 align-top ${i === best ? "font-semibold text-green-700" : ""}`}>
                            {r.show(r.values[i], p)}
                            {r.quality && (
                              <ul className="m-0 mt-1 list-none p-0 text-xs font-normal text-zinc-500">
                                {p.pageQuality.checks
                                  .filter((c) => !c.ok)
                                  .map((c) => (
                                    <li key={c.key}>✗ {c.label}</li>
                                  ))}
                              </ul>
                            )}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <s-text tone="neutral">
              Best value in each row is highlighted. Views and conversion appear once view sync is connected. Margin uses the unit cost
              in Shopify; page quality counts the diagnosis&apos;s per-product page checks.
            </s-text>
          </s-section>
        )}
      </s-stack>
    </s-page>
  );
}
