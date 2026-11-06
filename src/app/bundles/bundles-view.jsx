"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiError } from "@/app/api-error";
import { BTN, Card, CARD, H2, Notice, PageHeader, Pill, TH, THEAD, TROW, UpgradeNotice } from "@/app/ui/kit";
import { BUNDLE, END_REASONS } from "@/lib/bundles";
import { moneyFormatter, STATUS_INFO } from "@/lib/status-info";

const SUBTITLE = "Sell stuck stock with a product that sells well: shoppers who buy it get the stuck one at a discount. The price never goes under your margin floor.";

const INPUT = "w-20 rounded-lg border border-line-strong bg-white px-2 py-1.5 font-[inherit] text-[13px]";

const perDay = (n) => (n >= 1 ? n.toFixed(1) : n.toFixed(2));

async function send(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw await apiError(res);
  return res.json();
}

/** Bundles: suggestions to start, running bundles with what they did, and ended ones. */
export function BundlesView() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(null);

  async function load() {
    try {
      const res = await fetch("/api/bundles");
      if (!res.ok) throw await apiError(res);
      setData(await res.json());
      setLoadError(null);
    } catch (e) {
      setLoadError(e.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  /** Runs an action; resolves whether it worked. */
  async function act(key, run, done) {
    setBusy(key);
    setMessage(null);
    try {
      await run();
      setMessage({ tone: "good", text: done });
      await load();
      return true;
    } catch (e) {
      setMessage({ tone: "bad", text: e.message });
      return false;
    } finally {
      setBusy(null);
    }
  }

  const start = (product, partner, pct) =>
    act(`start:${product.gid}`, () => send("/api/bundles", { productGid: product.gid, partnerGid: partner.gid, pct }), `Started: shoppers who buy ${partner.title} get ${product.title} ${pct}% off.`);
  const end = (bundle) =>
    act(
      `end:${bundle.id}`,
      async () => {
        const result = await send(`/api/bundles/${bundle.id}/end`);
        // Shopify didn't confirm: say so (it's retried, and the discount stops by itself at the latest).
        if (!result.cleared) throw new Error(`Ended here, but Shopify didn't confirm yet. It's retried every hour, and the discount stops by itself${result.endsAt ? ` by ${new Date(result.endsAt).toLocaleString()}` : " within 2 days"}.`);
      },
      `Ended: the discount on ${bundle.product.title} stopped.`,
    );

  const locked = Boolean(data?.upgrade);
  const running = data?.bundles.filter((b) => b.status === "active") ?? [];
  const ended = data?.bundles.filter((b) => b.status === "ended") ?? [];
  const money = moneyFormatter(data?.currency, 0);

  return (
    <>
      <PageHeader title="Bundles" subtitle={SUBTITLE} />
      {loadError && <Notice tone="bad">{loadError}</Notice>}
      {!data && !loadError && <p className="m-0 text-muted">Loading your bundles…</p>}
      {locked && <UpgradeNotice>{data.error}</UpgradeNotice>}
      {message && (
        <Notice tone={message.tone} compact role={message.tone === "bad" ? "alert" : "status"}>
          {message.text}
        </Notice>
      )}

      {data && (
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(260px,1fr)]">
          <div className="flex min-w-0 flex-col gap-3">
            <Card heading="Running">
              {running.length === 0 ? (
                <p className="m-0 px-5 pb-4 text-[13px] text-muted">No bundle is running. Start one from the suggestions or make your own.</p>
              ) : (
                <ul className="m-0 flex list-none flex-col p-0">
                  {running.map((b) => (
                    <li key={b.id} className={`${TROW} flex flex-wrap items-start justify-between gap-3 px-5 py-3`}>
                      <div className="min-w-0 text-[13px]">
                        <p className="m-0">
                          Buy <Link href={`/products/${b.partner.id}`}>{b.partner.title}</Link>, get <Link href={`/products/${b.product.id}`}>{b.product.title}</Link>{" "}
                          <Pill tone="info">−{b.pct}%</Pill>
                        </p>
                        <p className="mt-1 mb-0 text-muted">
                          Since {new Date(b.startedAt).toLocaleDateString()}: {b.effect.orders} order{b.effect.orders === 1 ? "" : "s"} with both, {b.effect.units} sold through the bundle ({money.format(b.effect.revenue)}).{" "}
                          {b.product.title} sells {perDay(b.effect.perDaySince)} a day, against {perDay(b.effect.perDayBefore)} in the 30 days before.
                        </p>
                      </div>
                      <button type="button" disabled={Boolean(busy)} onClick={() => end(b)} className={`${BTN.small} cursor-pointer`}>
                        {busy === `end:${b.id}` ? "Ending…" : "End bundle"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {!locked && <Suggestions suggestions={data.suggestions} busy={busy} onStart={start} />}
            {!locked && <OwnBundle busy={busy} onStart={start} />}

            {ended.length > 0 && (
              <Card heading="Ended">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[13px]">
                    <thead className={THEAD}>
                      <tr>
                        <th className={TH} scope="col">
                          Bundle
                        </th>
                        <th className={TH} scope="col">
                          Sold through it
                        </th>
                        <th className={TH} scope="col">
                          Why it ended
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {ended.map((b) => (
                        <tr key={b.id} className={TROW}>
                          <td className="px-3 py-[9px]">
                            {b.partner.title} + {b.product.title} −{b.pct}%
                            <span className="block text-xs text-muted">
                              {new Date(b.startedAt).toLocaleDateString()} – {b.endedAt ? new Date(b.endedAt).toLocaleDateString() : "…"}
                            </span>
                          </td>
                          <td className="px-3 py-[9px]">
                            {b.effect.units} ({money.format(b.effect.revenue)})
                          </td>
                          <td className="px-3 py-[9px]">{END_REASONS[b.endReason] ?? "Ended"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>
          <HowItWorks />
        </div>
      )}
    </>
  );
}

/** Stuck products paired with products that sell well; the discount can be lowered (or raised up to the floor). */
function Suggestions({ suggestions, busy, onStart }) {
  const [pcts, setPcts] = useState({});
  return (
    <Card heading="Suggested bundles">
      {suggestions.length === 0 ? (
        <p className="m-0 px-5 pb-4 text-[13px] text-muted">
          No pair to suggest now: a bundle needs a stuck product with stock and a unit cost, and a product that sells (3+ in 30 days) in the same collection, of the same type, or bought with it.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {suggestions.map((s) => {
            const pct = pcts[s.product.gid] ?? s.pct;
            return (
              <li key={s.product.gid} className={`${TROW} flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-[13px]`}>
                <div className="min-w-0">
                  <p className="m-0">
                    Sell{" "}
                    <Link href={`/products/${s.product.id}`} className="font-semibold">
                      {s.product.title}
                    </Link>{" "}
                    {STATUS_INFO[s.product.status] && <Pill tone={s.product.status}>{STATUS_INFO[s.product.status].label}</Pill>} at a discount to shoppers who buy <strong>{s.partner.title}</strong>
                  </p>
                  <p className="mt-1 mb-0 text-muted">
                    {s.why} Up to {s.product.maxPct}% off keeps it above your margin floor.
                  </p>
                </div>
                <span className="flex items-center gap-2">
                  <label className="flex items-center gap-1">
                    Discount
                    <input type="number" min={BUNDLE.minPct} max={s.product.maxPct} value={pct} onChange={(e) => setPcts({ ...pcts, [s.product.gid]: Number(e.target.value) })} className={INPUT} />%
                  </label>
                  <button type="button" disabled={Boolean(busy)} onClick={() => onStart(s.product, s.partner, pct)} className={`${BTN.smallPrimary} cursor-pointer`}>
                    {busy === `start:${s.product.gid}` ? "Starting…" : "Start bundle"}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** A bundle the merchant picks: the stuck product, the one it's offered with, and the discount. */
function OwnBundle({ busy, onStart }) {
  const [product, setProduct] = useState(null);
  const [partner, setPartner] = useState(null);
  const [pct, setPct] = useState(BUNDLE.defaultPct);
  const [error, setError] = useState(null);

  async function pick(which) {
    if (!window.shopify) return;
    const picked = await window.shopify.resourcePicker({ type: "product", multiple: false, action: "select" });
    const chosen = picked?.[0];
    if (!chosen) return;
    setError(null);
    const other = which === "partner" ? product : partner;
    if (other?.gid === chosen.id) return setError("Choose two different products.");
    if (which === "partner") return setPartner({ gid: chosen.id, title: chosen.title });
    try {
      const res = await fetch(`/api/bundles/limit?gid=${encodeURIComponent(chosen.id)}`);
      if (!res.ok) throw await apiError(res);
      const limit = await res.json();
      setProduct({ gid: limit.gid, title: limit.title, maxPct: limit.pct, reason: limit.reason });
      if (limit.pct) setPct(Math.min(BUNDLE.defaultPct, limit.pct));
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <section aria-labelledby="own-bundle" className={`${CARD} flex flex-col gap-3 px-5 py-4 text-[13px]`}>
      <h2 id="own-bundle" className={H2}>
        Make your own
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => pick("product")} className={`${BTN.small} cursor-pointer`}>
          {product ? `Discounted: ${product.title}` : "Choose the product to sell"}
        </button>
        <span className="text-muted">with</span>
        <button type="button" onClick={() => pick("partner")} className={`${BTN.small} cursor-pointer`}>
          {partner ? `Bought: ${partner.title}` : "Choose the product that sells"}
        </button>
      </div>
      {error && <p className="m-0 font-semibold text-[#B91C1C]">{error}</p>}
      {product && !product.maxPct && (
        <p className="m-0 text-[#92400E]">
          {product.reason} Set each variant&apos;s &quot;Cost per item&quot; in Shopify (Products → the product → its variants), then choose it again.
        </p>
      )}
      {product?.maxPct > 0 && partner && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1">
            Discount <input type="number" min={BUNDLE.minPct} max={product.maxPct} value={pct} onChange={(e) => setPct(Number(e.target.value))} className={INPUT} />%
          </label>
          <span className="text-muted">up to {product.maxPct}%</span>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={async () => {
              if (await onStart(product, partner, pct)) {
                setProduct(null);
                setPartner(null);
              }
            }}
            className={`${BTN.smallPrimary} cursor-pointer`}
          >
            {busy === `start:${product.gid}` ? "Starting…" : "Start bundle"}
          </button>
        </div>
      )}
    </section>
  );
}

function HowItWorks() {
  return (
    <section className={`${CARD} flex flex-col gap-2 px-5 py-4 text-[13px] text-ink-2`}>
      <h2 className={H2}>How a bundle works</h2>
      <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5">
        <li>A Shopify automatic discount: when the cart has the product that sells, one unit of the stuck product gets the discount. Everyone else pays the full price.</li>
        <li>The discount never takes any variant under your margin floor (Settings), nor over your max discount.</li>
        <li>
          The offer (&quot;Buy together, save X%&quot;) shows on the selling product&apos;s page with the <strong>Product page boost</strong> or <strong>Unstuck product page</strong> block.
        </li>
        <li>It ends by itself when the stuck product sells out, a product is removed, or its floor no longer allows the discount.</li>
        <li>Needs the discounts permission: approve it once when Shopify asks after the app update.</li>
      </ul>
    </section>
  );
}
