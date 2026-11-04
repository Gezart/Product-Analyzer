"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiError } from "@/app/api-error";
import { CARD, H2, Notice, UpgradeNotice } from "@/app/ui/kit";
import { moneyFormatter } from "@/lib/status-info";

const pct = (n) => `${Math.round(Math.abs(n) * 100)}%`;
const day = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : null);
const isToday = (iso) => iso && new Date(iso).toDateString() === new Date().toDateString();

function linkPrice(link) {
  if (link.price == null) return null;
  return moneyFormatter(link.currency ?? undefined, 2).format(link.price) + (link.currency ? "" : " (currency unknown)");
}

/** "Your price €61.50 is 18% higher": orange past the store's "above the market" threshold. */
function GapLine({ gap, price, money, above }) {
  if (gap == null) return null;
  return (
    <p className={`m-0 text-[13px] font-semibold ${gap > above ? "text-[#9A3412]" : "text-ink-2"}`}>
      Your price {money.format(price)} is {Math.abs(gap) < 0.005 ? "the same" : `${pct(gap)} ${gap > 0 ? "higher" : "lower"}`}
    </p>
  );
}

function Shell({ children }) {
  return (
    <section id="market" aria-labelledby="mkt" className={`${CARD} flex min-w-0 scroll-mt-4 flex-col gap-3 px-5 py-[18px]`}>
      <h2 id="mkt" className={H2}>
        Market price
      </h2>
      {children}
    </section>
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

  if (error) return <Shell><Notice tone="bad" compact>Could not load competitor prices: {error}</Notice></Shell>;
  if (!data) return <Shell><p className="m-0 text-[13px] text-muted">Loading competitor prices…</p></Shell>;
  if (data.upgrade) return <Shell><UpgradeNotice>Comparing your price with competitors is included from the Starter plan.</UpgradeNotice></Shell>;

  const money = moneyFormatter(data.currency, 2);
  const { competitors, gap, google } = data;
  const full = data.links.length >= data.max;

  return (
    <Shell>
      {google && (
        <div className="rounded-[10px] border border-line px-3.5 py-3">
          <p className="m-0 text-xs text-muted">
            Google Shopping benchmark{google.country ? ` · ${google.country}` : ""} · {isToday(google.syncedAt) ? "today" : `read ${day(google.syncedAt)}`}
          </p>
          <p className="mt-1 mb-0 text-[22px] font-bold tabular-nums">{money.format(google.benchmark)}</p>
          <GapLine gap={google.gap} price={data.price} money={money} above={data.marketAbove} />
        </div>
      )}
      {!google && competitors.median != null && (
        <div className="rounded-[10px] border border-line px-3.5 py-3">
          <p className="m-0 text-xs text-muted">
            Competitors · median of {competitors.count} price{competitors.count === 1 ? "" : "s"}
          </p>
          <p className="mt-1 mb-0 text-[22px] font-bold tabular-nums">{money.format(competitors.median)}</p>
          <GapLine gap={gap} price={data.price} money={money} above={data.marketAbove} />
        </div>
      )}
      {data.googleSuggested && (
        <p className="m-0 text-[13px] text-muted">
          Sell on Google? Connect Google Merchant Center in <Link href="/settings">Settings</Link> to see what shoppers pay for this product there.
        </p>
      )}

      <div>
        <p className="mt-0 mb-1.5 font-semibold">
          Competitor links{competitors.median != null ? ` · median ${money.format(competitors.median)}` : ""}
          {google && gap != null && Math.abs(gap) >= 0.005 && (
            <span className={`ml-1 text-[13px] ${gap > data.marketAbove ? "text-[#9A3412]" : "text-muted"}`}>
              (yours {pct(gap)} {gap > 0 ? "higher" : "lower"})
            </span>
          )}
        </p>
        {data.links.length === 0 ? (
          <p className="m-0 text-[13px] text-muted">
            Add links to the same product in other shops. Their prices are compared with yours (in {data.currency ?? "your currency"} only).
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col p-0">
            {data.links.map((link) => (
              <li key={link.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-t border-hair py-[7px] text-[13px]">
                <a href={link.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 text-ink [overflow-wrap:anywhere] hover:text-ink">
                  {link.host}
                </a>
                {link.status === "ok" && <span className="font-semibold tabular-nums">{linkPrice(link)}</span>}
                {link.status === "failed" && (
                  <span className="font-semibold text-[#B45309]">
                    {link.error}
                    {link.price != null ? ` Last price: ${linkPrice(link)}.` : ""}
                  </span>
                )}
                {link.status === "pending" && <span className="text-muted">Not read yet</span>}
                {link.status === "ok" && data.currency && link.currency && link.currency !== data.currency && <span className="text-muted">Not compared (other currency)</span>}
                <span className="flex w-full items-baseline justify-between gap-2 text-xs text-muted">
                  <span>{day(link.checkedAt) ? `Checked ${day(link.checkedAt)}` : ""}</span>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => send("DELETE", { linkId: link.id }, link.id)}
                    className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-xs font-semibold text-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy === link.id ? "Removing…" : "Remove"}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {message && <Notice tone="bad" compact>{message}</Notice>}
      {full ? (
        <p className="m-0 text-[13px] text-muted">This product has the maximum of {data.max} links. Remove one to add another.</p>
      ) : (
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) send("POST", { url }, "add");
          }}
        >
          <label htmlFor="competitor-link" className="sr-only">
            Competitor link
          </label>
          <input
            id="competitor-link"
            type="url"
            placeholder="https://competitor.com/products/…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-line-strong px-2.5 py-2 font-[inherit] text-[13px]"
          />
          <button
            type="submit"
            disabled={!url.trim() || busy !== null}
            className="cursor-pointer rounded-lg border border-line-strong bg-white px-3 py-2 font-[inherit] text-[13px] font-semibold text-ink hover:bg-head disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "add" ? "Adding…" : "Add"}
          </button>
        </form>
      )}
      <p className="m-0 text-xs text-muted">Up to {data.max} links. Prices are read when you add a link and every night.</p>
    </Shell>
  );
}
