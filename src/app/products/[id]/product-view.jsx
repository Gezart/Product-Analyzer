"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { moneyFormatter, STATUS_INFO } from "@/lib/status-info";
import { Diagnosis } from "./diagnosis";
import { FixCenter } from "./fix-center";
import { Markdown } from "./markdown";
import { RescuePlan } from "./rescue-plan";
import { SalesChart } from "./sales-chart";

const pct = (n) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);

export function ProductView() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);
  const refresh = useRef(undefined);
  useEffect(() => () => clearTimeout(refresh.current), []);

  useEffect(() => {
    fetch(`/api/products/${id}`)
      .then(async (res) => (res.ok ? setData(await res.json()) : Promise.reject(new Error(res.status === 404 ? "Product not found" : String(res.status)))))
      .catch((e) => setError(e.message));
  }, [id, version]);

  if (error) return <s-page heading="Product"><s-banner tone="critical">{error}</s-banner></s-page>;
  if (!data) return <s-page heading="Product"><s-spinner accessibilityLabel="Loading product" /></s-page>;

  const money = moneyFormatter(data.currency);
  const money2 = moneyFormatter(data.currency, 2);
  const info = data.score ? STATUS_INFO[data.score.status] : null;

  return (
    <s-page heading={data.product.title}>
      <s-stack gap="base">
        <div>
          <Link href="/" className="text-sm text-zinc-600 hover:underline">
            ← Catalog health
          </Link>
          <Link href={`/compare?ids=${data.product.id}`} className="ml-4 text-sm text-zinc-600 hover:underline">
            Compare with other products
          </Link>
        </div>

        {data.rescuePlan && <RescuePlan plan={data.rescuePlan} onChanged={() => setVersion((v) => v + 1)} />}
        <Markdown productId={data.product.id} money={money2} onChanged={() => setVersion((v) => v + 1)} />
        <Diagnosis productId={data.product.id} key={`diagnosis-${version}`} />
        <FixCenter
          productId={data.product.id}
          onChanged={() => {
            // Local data is refreshed by a background sync job; reload shortly after.
            clearTimeout(refresh.current);
            refresh.current = setTimeout(() => setVersion((v) => v + 1), 3000);
          }}
        />

        <s-section id="overview">
          <s-stack gap="small">
            <s-stack direction="inline" gap="small" alignItems="center">
              {info && <s-badge tone={info.tone}>{info.label}</s-badge>}
              {data.product.status !== "ACTIVE" && <s-badge>{data.product.status.toLowerCase()}</s-badge>}
            </s-stack>
            {info && <s-text>Next: {info.action}</s-text>}
            <div className="grid gap-4 sm:grid-cols-4">
              <Stat label="In stock" value={data.stock.toLocaleString()} />
              <Stat
                label="Stock value"
                value={money.format(data.stockValue)}
                note={data.stockValueIsEstimate ? "estimated (price × 50%)" : undefined}
              />
              <Stat label="Days of stock" value={data.daysOfCover == null ? "—" : Math.round(data.daysOfCover).toLocaleString()} />
              <Stat label="Last sale" value={data.lastSale ?? "none in history"} />
              <Stat
                label="Money at stake"
                value={data.score && !["over_limit", "excluded"].includes(data.score.status) ? money.format(data.score.moneyAtStake) : "—"}
              />
              <Stat label="Sell-through (60 days)" value={pct(data.score?.sellThrough ?? null)} />
              <Stat label="Trend (30 vs previous 30)" value={data.trend == null ? "—" : `${data.trend.toFixed(2)}×`} />
              <Stat label="Price" value={money2.format(data.product.price)} />
              <Stat label="Product type" value={data.product.productType ?? "—"} />
              <Stat label="Collections" value={String(data.product.collections)} />
            </div>
          </s-stack>
        </s-section>

        <s-section heading="Sales and views" id="metrics">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-zinc-500">
                <tr>
                  <th className="py-2 pr-4 font-medium">Last</th>
                  <th className="py-2 pr-4 text-right font-medium">Units</th>
                  <th className="py-2 pr-4 text-right font-medium">Revenue</th>
                  <th className="py-2 pr-4 text-right font-medium">Views</th>
                  <th className="py-2 pr-4 text-right font-medium">View → cart</th>
                  <th className="py-2 text-right font-medium">View → purchase</th>
                </tr>
              </thead>
              <tbody>
                {data.windows.map((w) => (
                  <tr key={w.days} className="border-t border-zinc-200">
                    <td className="py-2 pr-4">
                      {w.days} days{w.partial ? <span className="text-zinc-500"> (only {data.knownDays} days known)</span> : null}
                    </td>
                    <td className="py-2 pr-4 text-right">{w.units.toLocaleString()}</td>
                    <td className="py-2 pr-4 text-right">{money.format(w.revenue)}</td>
                    <td className="py-2 pr-4 text-right">{w.views.toLocaleString()}</td>
                    <td className="py-2 pr-4 text-right">{pct(w.viewToCart)}</td>
                    <td className="py-2 text-right">{pct(w.viewToPurchase)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <s-text tone="neutral">
            Views come from Shopify analytics once view sync is connected. Order history starts at install with the last 60 days.
          </s-text>
        </s-section>

        <s-section heading="Units sold per day (last 90 days)">
          <SalesChart days={data.daily} formatMoney={(n) => money2.format(n)} />
        </s-section>

        <s-section heading="Product page" id="page">
          <div className="grid gap-4 sm:grid-cols-4">
            <Stat label="Images" value={String(data.product.imageCount)} />
            <Stat label="Description" value={`${data.product.descriptionWords} words`} />
            <Stat label="SEO title" value={data.product.seoTitle ? "Set" : "Missing"} />
            <Stat label="Meta description" value={data.product.seoDescription ? "Set" : "Missing"} />
          </div>
          {data.product.descriptionPreview && (
            <p className="mt-3 text-sm text-zinc-600">
              {data.product.descriptionPreview}
              {data.product.descriptionPreview.length >= 400 ? "…" : ""}
            </p>
          )}
        </s-section>

        <s-section heading="Variants" id="variants">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-zinc-500">
                <tr>
                  <th className="py-2 pr-4 font-medium">Variant</th>
                  <th className="py-2 pr-4 font-medium">SKU</th>
                  <th className="py-2 pr-4 text-right font-medium">Price</th>
                  <th className="py-2 text-right font-medium">Stock</th>
                </tr>
              </thead>
              <tbody>
                {data.variants.map((v) => (
                  <tr key={v.id} className="border-t border-zinc-200">
                    <td className="py-2 pr-4">{Object.values(v.options).join(" / ") || "Default"}</td>
                    <td className="py-2 pr-4">{v.sku ?? "—"}</td>
                    <td className="py-2 pr-4 text-right">{money2.format(v.price)}</td>
                    <td className={`py-2 text-right ${v.stock <= 0 ? "text-red-700" : ""}`}>{v.stock}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </s-section>
      </s-stack>
    </s-page>
  );
}

function Stat({ label, value, note }) {
  return (
    <div>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {note && <div className="text-xs text-zinc-500">{note}</div>}
    </div>
  );
}
