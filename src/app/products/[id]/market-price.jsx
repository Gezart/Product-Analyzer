"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiError } from "@/app/api-error";
import { listen } from "@/app/polaris-events";
import { UpgradeBanner } from "@/app/upgrade-banner";
import { moneyFormatter } from "@/lib/status-info";

const pct = (n) => `${Math.round(Math.abs(n) * 100)}%`;
const day = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : null);

function linkPrice(link) {
  if (link.price == null) return null;
  return moneyFormatter(link.currency ?? undefined, 2).format(link.price) + (link.currency ? "" : " (currency unknown)");
}

/** One market price and how far the product's price is from it. */
function MarketBox({ label, value, gap, price, money, above }) {
  return (
    <s-box padding="base" background="subdued" borderRadius="base">
      <s-stack gap="small-200">
        <s-text tone="neutral">{label}</s-text>
        <span className="text-2xl font-semibold">{money.format(value)}</span>
        {gap != null && (
          <span className={`text-sm font-medium ${gap > above ? "text-orange-800" : "text-zinc-700"}`}>
            Your price {money.format(price)} is {Math.abs(gap) < 0.005 ? "the same" : `${pct(gap)} ${gap > 0 ? "higher" : "lower"}`}
          </span>
        )}
      </s-stack>
    </s-box>
  );
}

/**
 * The market price for this product: Google's benchmark (when Merchant Center is connected) and the
 * competitors' prices from links the merchant adds, read when added and every night.
 */
export function MarketPrice({ productId, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    fetch(`/api/products/${productId}/competitors`)
      .then(async (res) => (res.ok ? setData(await res.json()) : Promise.reject(await apiError(res))))
      .catch((e) => setError(e.message));
  }, [productId]);

  async function send(method, body, action) {
    if (busy) return;
    setBusy(action);
    setMessage(null);
    try {
      const res = await fetch(`/api/products/${productId}/competitors`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw await apiError(res);
      setData(await res.json());
      if (method === "POST") setUrl("");
      onChanged?.(); // the diagnosis compares with the new market price
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(null);
    }
  }

  if (error) return <s-section heading="Market price"><s-banner tone="critical">Could not load competitor prices: {error}</s-banner></s-section>;
  if (!data) return <s-section heading="Market price"><s-spinner accessibilityLabel="Loading competitor prices" /></s-section>;
  if (data.upgrade) {
    return (
      <s-section heading="Market price">
        <UpgradeBanner>Comparing your price with competitors is included from the Starter plan.</UpgradeBanner>
      </s-section>
    );
  }

  const money = moneyFormatter(data.currency, 2);
  const { competitors, gap, google } = data;
  const full = data.links.length >= data.max;

  return (
    <s-section heading="Market price" id="market">
      <s-stack gap="base">
        {(google || competitors.median != null) && (
          <div className="grid gap-3 sm:grid-cols-2">
            {competitors.median != null && (
              <MarketBox
                label={`Competitors · median of ${competitors.count} price${competitors.count === 1 ? "" : "s"}`}
                value={competitors.median}
                gap={gap}
                price={data.price}
                money={money}
                above={data.marketAbove}
              />
            )}
            {google && (
              <MarketBox
                label={`Google Shopping · average price${google.country ? ` in ${google.country}` : ""} · read ${day(google.syncedAt)}`}
                value={google.benchmark}
                gap={google.gap}
                price={data.price}
                money={money}
                above={data.marketAbove}
              />
            )}
          </div>
        )}
        {competitors.median == null && (
          <s-text tone="neutral">
            Add links to the same product in other shops. Their prices are compared with yours (in {data.currency ?? "your currency"} only).
          </s-text>
        )}
        {data.googleSuggested && (
          <s-text tone="neutral">
            Sell on Google? Connect Google Merchant Center in <Link href="/settings" className="underline">Settings</Link> to see what shoppers pay for this product there.
          </s-text>
        )}

        {data.links.length > 0 && (
          <ul className="m-0 list-none divide-y divide-zinc-200 p-0">
            {data.links.map((link) => (
              <li key={link.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm">
                <a href={link.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 break-all font-medium text-zinc-900 underline">
                  {link.host}
                </a>
                {link.status === "ok" && <span className="font-semibold">{linkPrice(link)}</span>}
                {link.status === "failed" && (
                  <span className="text-orange-800">
                    {link.error}
                    {link.price != null ? ` Last price: ${linkPrice(link)}.` : ""}
                  </span>
                )}
                {link.status === "pending" && <span className="text-zinc-500">Not read yet</span>}
                {link.status === "ok" && data.currency && link.currency && link.currency !== data.currency && (
                  <span className="text-zinc-500">Not compared (other currency)</span>
                )}
                <span className="text-zinc-500">{day(link.checkedAt) ? `Checked ${day(link.checkedAt)}` : ""}</span>
                <s-button variant="tertiary" disabled={busy !== null || undefined} loading={busy === link.id || undefined} ref={listen("click", () => send("DELETE", { linkId: link.id }, link.id))}>
                  Remove
                </s-button>
              </li>
            ))}
          </ul>
        )}

        {message && <s-banner tone="critical">{message}</s-banner>}
        {full ? (
          <s-text tone="neutral">This product has the maximum of {data.max} links. Remove one to add another.</s-text>
        ) : (
          <s-stack direction="inline" gap="small" alignItems="end">
            <div className="min-w-0 flex-1">
              <s-text-field
                label="Competitor link"
                placeholder="https://competitor.com/products/…"
                value={url}
                ref={listen("input", (el) => setUrl(el.value))}
              />
            </div>
            <s-button disabled={!url.trim() || busy !== null || undefined} loading={busy === "add" || undefined} ref={listen("click", () => send("POST", { url }, "add"))}>
              Add
            </s-button>
          </s-stack>
        )}
        <s-text tone="neutral">Up to {data.max} links. Prices are read when you add a link and every night.</s-text>
      </s-stack>
    </s-section>
  );
}
