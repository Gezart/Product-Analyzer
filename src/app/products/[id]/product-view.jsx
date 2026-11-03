"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { returnPct } from "@/lib/diagnosis";
import { seasonGraceDays, seasonWaiting } from "@/lib/scoring";
import { justEnded } from "@/lib/season";
import { formatDays, moneyFormatter, STATUS_INFO } from "@/lib/status-info";
import { Diagnosis } from "./diagnosis";
import { FixCenter } from "./fix-center";
import { Markdown } from "./markdown";
import { MarketPrice } from "./market-price";
import { RescuePlan } from "./rescue-plan";
import { SalesChart } from "./sales-chart";

const pct = (n) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);
// Shopify names the only variant of a simple product "Default Title".
const variantName = (options) => Object.values(options ?? {}).filter((o) => o !== "Default Title").join(" / ") || "Default";

export function ProductView() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);
  // Bumped when competitor prices change: only the diagnosis needs to run again.
  const [marketVersion, setMarketVersion] = useState(0);
  const refresh = useRef(undefined);
  useEffect(() => () => clearTimeout(refresh.current), []);

  useEffect(() => {
    fetch(`/api/products/${id}`)
      .then(async (res) => (res.ok ? setData(await res.json()) : Promise.reject(new Error(res.status === 404 ? "Product not found" : String(res.status)))))
      .catch((e) => setError(e.message));
  }, [id, version]);

  // A link to a section (e.g. from the weekly plan) arrives before the page has loaded: scroll once it has.
  const scrolled = useRef(false);
  useEffect(() => {
    if (!data || scrolled.current || !window.location.hash) return;
    scrolled.current = true;
    const id = decodeURIComponent(window.location.hash.slice(1));
    // Sections that load their own data (e.g. the diagnosis) show up a moment later.
    const tryScroll = (tries) => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      else if (tries > 0) setTimeout(() => tryScroll(tries - 1), 300);
    };
    tryScroll(10);
  }, [data]);

  if (error) return <s-page heading="Product"><s-banner tone="critical">{error}</s-banner></s-page>;
  if (!data) return <s-page heading="Product"><s-spinner accessibilityLabel="Loading product" /></s-page>;

  const money = moneyFormatter(data.currency);
  const money2 = moneyFormatter(data.currency, 2);
  const info = data.score ? STATUS_INFO[data.score.status] : null;
  // A running markdown or a rescue plan decides what comes next, before the status's general advice.
  const rescue = data.rescuePlan;
  const season = data.product.season;
  const next = data.markdownRunning
    ? "A markdown is running (see below)."
    : rescue && !rescue.verdict
      ? "Wait for the rescue plan's result (below)."
      : rescue?.verdict === "worse" && rescue.fixIds.length > 0
        ? (rescue.moves ?? []).length === rescue.fixIds.length
          ? "Undo the new collection order (see the rescue plan below)."
          : "Undo the fixes (see the rescue plan below)."
        : justEnded(season) && data.stock > 0 && data.product.status === "ACTIVE" && !["excluded", "over_limit"].includes(data.score?.status)
          ? "Its season has ended: start an end-of-season markdown to clear the stock (see below)."
          : rescue?.verdict === "no_change" && !seasonWaiting(season)
            ? "Start the markdown (see below)."
            : data.score?.status === "seasonal" && season
              ? seasonalNext(season)
              : info?.action;

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

        <s-section id="overview">
          <s-stack gap="small">
            <s-stack direction="inline" gap="small" alignItems="center">
              {info && <s-badge tone={info.tone}>{info.label}</s-badge>}
              {data.product.status !== "ACTIVE" && <s-badge>{data.product.status.toLowerCase()}</s-badge>}
            </s-stack>
            {next && <s-text>Next: {next}</s-text>}
            <div className="grid gap-4 sm:grid-cols-4">
              <Stat label="In stock" value={data.untracked ? "Sells without stock" : data.stock.toLocaleString()} />
              <Stat
                label="Stock value"
                value={money.format(data.stockValue)}
                note={data.stockValueIsEstimate ? "estimated (price × 50%)" : undefined}
              />
              <Stat
                label="Days of stock"
                value={data.untracked ? "—" : data.daysOfCover != null ? formatDays(data.daysOfCover) : data.stock > 0 ? "No sales in 30 days" : "—"}
              />
              <Stat label="Last sale" value={data.lastSale ?? "none in history"} />
              <Stat
                label="Money at stake"
                value={data.score && !["over_limit", "excluded"].includes(data.score.status) ? money.format(data.score.moneyAtStake) : "—"}
              />
              <Stat label={season?.inSeason && season.daysIntoSeason < 60 ? "Sell-through (season so far)" : "Sell-through (60 days)"} value={pct(data.score?.sellThrough ?? null)} />
              <Stat label="Trend (30 vs previous 30)" value={data.trend == null ? "—" : `${data.trend.toFixed(2)}×`} />
              <Stat label="Price" value={money2.format(data.product.price)} />
              <Stat label="Product type" value={data.product.productType ?? "—"} />
              <Stat label="Collections" value={String(data.product.collections)} />
              {data.product.season && <Stat label="Season" value={data.product.season.label} note={seasonNote(data.product.season)} />}
            </div>
            {data.returns?.returned > 0 && <Returns returns={data.returns} money={money} />}
          </s-stack>
        </s-section>

        {data.rescuePlan && <RescuePlan plan={data.rescuePlan} onChanged={() => setVersion((v) => v + 1)} />}
        <Markdown productId={data.product.id} money={money2} onChanged={() => setVersion((v) => v + 1)} />
        <Diagnosis productId={data.product.id} key={`diagnosis-${version}-${marketVersion}`} />
        <MarketPrice productId={data.product.id} onChanged={() => setMarketVersion((v) => v + 1)} />
        <FixCenter
          productId={data.product.id}
          onChanged={() => {
            // Local data is refreshed by a background sync job; reload shortly after.
            clearTimeout(refresh.current);
            refresh.current = setTimeout(() => setVersion((v) => v + 1), 3000);
          }}
        />

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
            {data.windows[2].views === 0 && "Views come from Shopify analytics once view sync is connected. "}Order history starts at install with the last 60 days.
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
                    <td className="py-2 pr-4">{variantName(v.options)}</td>
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

/** How often the product comes back, against the store, and why. */
function Returns({ returns, money }) {
  const pctOf = (n) => (n == null ? "—" : returnPct(n));
  return (
    <div id="returns" className="rounded-lg bg-zinc-50 p-3 text-sm">
      <div className="font-medium">
        Returns ({returns.days} days): {pctOf(returns.rate)} · {returns.returned} of {returns.sold} units came back
      </div>
      <div className="text-zinc-600">
        Store average {pctOf(returns.storeRate)} · {money.format(returns.refunded)} refunded
        {returns.reasons.length > 0 && ` · ${returns.reasons.map((r) => `${r.name} (${r.count})`).join(", ")}`}
      </div>
    </div>
  );
}

/** What a seasonal product needs now: nothing until its season, or a little time early in it. */
function seasonalNext(season) {
  if (!season.inSeason) return `Nothing until its season (${season.label}) starts in ${season.daysToStart} day${season.daysToStart === 1 ? "" : "s"}; it isn't dead stock.`;
  const left = seasonGraceDays(season.seasonDays) - season.daysIntoSeason;
  if (left <= 0) return `Its season (${season.label}) is underway; it's judged at the next nightly analysis.`;
  return `Its season (${season.label}) has just started; it's judged in ${left} day${left === 1 ? "" : "s"}.`;
}

/** "In season since 1 Nov" or "Starts 1 Nov (in 114 days)", and where the season comes from. */
function seasonNote(season) {
  const date = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
  const when = season.inSeason ? `In season since ${date(season.start)}` : `Starts ${date(season.nextStart)} (in ${season.daysToStart} day${season.daysToStart === 1 ? "" : "s"})`;
  return `${when} · from ${season.source === "tag" ? "its tag" : "a seasonal collection"}`;
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
