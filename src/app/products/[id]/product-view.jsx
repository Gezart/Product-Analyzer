"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BTN, CARD, H2, Notice, PageHeader, Pill, THEAD, TROW } from "@/app/ui/kit";
import { useHashScroll } from "@/app/ui/use-hash-scroll";
import { returnPct } from "@/lib/diagnosis";
import { lastSaleLabel, markdownCard, nextFromReasons, salesBars, SECTION_ALIASES } from "@/lib/product-page";
import { growthLabel, risingActions } from "@/lib/rising";
import { seasonGraceDays, seasonWaiting } from "@/lib/scoring";
import { justEnded } from "@/lib/season";
import { formatDays, moneyFormatter, STATUS_INFO } from "@/lib/status-info";
import { ActionCard } from "./action-card";
import { Diagnosis } from "./diagnosis";
import { MarketPrice } from "./market-price";
import { RescuePlan } from "./rescue-plan";

const pct0 = (n) => (n == null ? "—" : `${Math.round(n * 100)}%`);
const pct1 = (n) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);
const shortDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
// Shopify names the only variant of a simple product "Default Title".
const variantName = (options) => Object.values(options ?? {}).filter((o) => o !== "Default Title").join(" / ") || "Default";
const PERIODS = [30, 60, 90];

export function ProductView() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);
  // Bumped when competitor prices change: only the diagnosis needs to run again.
  const [marketVersion, setMarketVersion] = useState(0);
  const [diagnosis, setDiagnosis] = useState(null);
  const [period, setPeriod] = useState(30);

  useEffect(() => {
    fetch(`/api/products/${id}`)
      .then(async (res) => (res.ok ? setData(await res.json()) : Promise.reject(new Error(res.status === 404 ? "Product not found" : String(res.status)))))
      .catch((e) => setError(e.message));
  }, [id, version]);

  // The diagnosis runs with the page: the next step is read from its reasons.
  useEffect(() => {
    let current = true;
    setDiagnosis(null);
    fetch(`/api/products/${id}/diagnosis`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (res.status === 403 && body.upgrade) return { upgrade: body.error };
        if (!res.ok) throw new Error(String(res.status));
        return body;
      })
      .catch(() => ({ error: true }))
      .then((d) => current && setDiagnosis(d));
    return () => {
      current = false;
    };
  }, [id, version, marketVersion]);

  // A link to a section (e.g. from the weekly plan) arrives before the page has loaded: scroll once it has.
  useHashScroll(Boolean(data), SECTION_ALIASES);

  const back = { href: "/products", label: "Products" };
  if (error) return <><PageHeader back={back} title="Product" /><Notice tone="bad">{error}</Notice></>;
  if (!data) return <><PageHeader back={back} title="Product" /><p className="m-0 text-muted">Loading product…</p></>;

  const money = moneyFormatter(data.currency);
  const money2 = moneyFormatter(data.currency, 2);
  const status = data.score?.status ?? null;
  const info = status ? STATUS_INFO[status] : null;
  const season = data.product.season;
  const next = nextStep(data, diagnosis, id);
  const aboveMarket = data.marketGap != null && data.marketGap > data.marketAbove;
  const refresh = () => setVersion((v) => v + 1);

  return (
    <>
      <Link href="/products" className="self-start text-[13px] font-semibold">
        ← Products
      </Link>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3.5">
          <div aria-hidden="true" className="h-14 w-14 flex-none rounded-[10px] bg-[#E9EBEF]" />
          <div className="min-w-0">
            <h1 className="m-0 text-[22px] font-bold tracking-[-0.01em]">{data.product.title}</h1>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {info && <Pill tone={status}>{info.label}</Pill>}
              {aboveMarket && <Pill tone="page_problem">{Math.round(data.marketGap * 100)}% above market</Pill>}
              {data.score?.rising && <Pill tone="rising">Rising star</Pill>}
              {data.markdown?.running && (
                <Pill tone="neutral">{data.markdown.running.status === "paused" ? "Markdown · paused" : data.markdown.running.step ? `Markdown · step ${data.markdown.running.step}` : "Markdown · starting"}</Pill>
              )}
              {data.product.status !== "ACTIVE" && <Pill tone="neutral">{data.product.status === "DRAFT" ? "Draft" : data.product.status === "ARCHIVED" ? "Archived" : data.product.status.toLowerCase()}</Pill>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/compare?ids=${data.product.id}`} className={BTN.secondary}>
            Compare
          </Link>
          <Link href={`/products/${data.product.id}/fix`} className={BTN.primary}>
            Fix the page
          </Link>
        </div>
      </header>

      {next && (
        <section aria-label="Next step" className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-accent-line bg-accent-soft px-[18px] py-3.5">
          <p className="m-0 flex-[1_1_420px]">
            <strong>Next step:</strong> {next.text}
          </p>
          {next.cta && <Go href={next.cta.href} className="font-semibold">{next.cta.label} →</Go>}
        </section>
      )}

      {season && (
        <section aria-label="Season" className="rounded-xl border border-[#5EBDB3] bg-[#F0FDFA] px-[18px] py-3 text-[#134E4A]">
          <p className="m-0">
            <strong>Seasonal · {season.label}.</strong> {seasonNote(season)}. Seasonal products are not called slow or dead off season.
          </p>
        </section>
      )}

      <dl className="m-0 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {numbers(data, money).map((k) => (
          <div key={k.label} className="min-w-0 rounded-xl border border-line bg-white px-3.5 py-3">
            <dt className="text-xs text-muted">{k.label}</dt>
            <dd className="mt-1 mb-0 text-[19px] font-bold tabular-nums">{k.value}</dd>
            <dd className="m-0 text-xs text-muted">{k.sub}</dd>
          </div>
        ))}
      </dl>

      <Sales data={data} period={period} setPeriod={setPeriod} money={money} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Diagnosis productId={data.product.id} diagnosis={diagnosis} />
        <MarketPrice productId={data.product.id} onChanged={() => setMarketVersion((v) => v + 1)} />
      </div>

      <Variants data={data} money={money2} />

      <div className="grid gap-4 md:grid-cols-2">
        <RescuePlan plan={data.rescuePlan} productId={data.product.id} onChanged={refresh} />
        <MarkdownSummary data={data} money={money2} />
        {(data.score?.rising || (data.risingActions ?? []).length > 0) && (
          <RisingStar
            productId={id}
            rising={Boolean(data.score?.rising)}
            trend={data.score?.trend}
            // Sold without stock (e.g. gift cards): days of stock don't apply, so no reorder advice.
            daysOfCover={data.untracked ? null : data.daysOfCover}
            actions={data.risingActions ?? []}
            onChanged={refresh}
          />
        )}
        {data.returns?.returned > 0 && <Returns returns={data.returns} money={money} />}
      </div>
    </>
  );
}

/** A link within the page (#section) or to another page. */
function Go({ href, className, children }) {
  return href.startsWith("#") ? (
    <a href={href} className={className}>
      {children}
    </a>
  ) : (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

/**
 * What to do next: a running markdown or rescue plan first, then the season, then the diagnosis's
 * reasons, then the status's general advice. `{ text, cta: { label, href } | null }` or null.
 */
function nextStep(data, diagnosis, id) {
  const rescue = data.rescuePlan;
  const season = data.product.season;
  const status = data.score?.status;
  const markdown = { label: "Open the markdown", href: `/products/${id}/markdown` };
  const rescueCta = { label: "See the rescue plan", href: "#rescue" };
  if (data.markdownRunning) return { text: "A markdown is running: its price steps down every 14 days until the stock sells.", cta: markdown };
  if (rescue && !rescue.verdict) return { text: "Wait for the rescue plan's result: it's measuring the fixes.", cta: rescueCta };
  if (rescue?.verdict === "worse" && rescue.fixIds.length > 0) {
    const allMoves = (rescue.moves ?? []).length === rescue.fixIds.length;
    return { text: allMoves ? "Sales fell after the new collection order: undo it." : "Sales fell after the fixes: undo them.", cta: rescueCta };
  }
  const canMarkDown = data.stock > 0 && data.product.status === "ACTIVE" && !["excluded", "over_limit"].includes(status);
  if (justEnded(season) && canMarkDown) return { text: "Its season has ended: start an end-of-season markdown to clear the stock.", cta: { ...markdown, label: "Start markdown" } };
  if (rescue?.verdict === "no_change" && !seasonWaiting(season)) return { text: "The fixes didn't move sales: start the markdown.", cta: { ...markdown, label: "Start markdown" } };
  if (status === "seasonal" && season) return { text: seasonalNext(season), cta: null };
  if (["dead_stock", "slow_mover", "page_problem"].includes(status)) {
    const fromReasons = nextFromReasons(diagnosis?.reasons, id);
    if (fromReasons) return fromReasons;
    return { text: `${STATUS_INFO[status].action}.`, cta: { label: "Start in Fix center", href: `/products/${id}/fix` } };
  }
  if (status === "hidden_gem") return { text: "Give it a better place in its collections: it sells well to the few who see it.", cta: { label: "Open Collections", href: "/collections" } };
  if (status === "stockout_risk") return { text: "Reorder before it sells out.", cta: { label: "See variants", href: "#variants" } };
  if (status === "over_limit") return { text: `${STATUS_INFO.over_limit.action}.`, cta: { label: "See plans", href: "/plans" } };
  return status && STATUS_INFO[status] ? { text: `${STATUS_INFO[status].action}.`, cta: null } : null;
}

/** The six numbers under the header. */
function numbers(data, money) {
  const s = data.score;
  const analyzed = s && !["over_limit", "excluded", "unscored"].includes(s.status);
  const season = data.product.season;
  const w30 = data.windows[0];
  const last = lastSaleLabel(data.lastSale, data.today);
  const days = data.untracked
    ? { value: "—", sub: "sells without stock" }
    : data.daysOfCover != null
      ? { value: formatDays(data.daysOfCover), sub: "at today's pace" }
      : data.stock > 0
        ? { value: "over a year", sub: "no sales in 30 days" }
        : { value: "—", sub: "no stock" };
  return [
    {
      label: "Money at stake",
      value: analyzed ? money.format(s.moneyAtStake) : "—",
      sub: analyzed && s.moneyAtStake > 0 && s.stockValue > 0 ? `${pct0(s.moneyAtStake / s.stockValue)} of stock value` : analyzed ? "" : "not analyzed",
    },
    {
      label: "Stock",
      value: data.untracked ? "—" : data.stock.toLocaleString(),
      sub: data.untracked ? "sells without stock" : `${money.format(data.stockValue)} at cost${data.stockValueIsEstimate ? " (est.)" : ""}`,
    },
    { label: "Sell-through", value: pct0(s?.sellThrough ?? null), sub: season?.inSeason && season.daysIntoSeason < 60 ? "season so far" : "last 60 days" },
    { label: "Days of stock", ...days },
    {
      label: "Conversion",
      value: pct1(w30.viewToPurchase),
      sub: w30.viewToPurchase != null && data.storeConversion != null ? `store average ${pct1(data.storeConversion)}` : w30.views > 0 ? `${w30.views.toLocaleString()} visits in 30 days` : "no visit data yet",
    },
    { label: "Last sale", value: last?.value ?? "None", sub: last ? last.sub : "in known history" },
  ];
}

/** "Daily sales · N sold in 30 days" with the 30/60/90 toggle, and the window's totals underneath. */
function Sales({ data, period, setPeriod, money }) {
  const { bars, total, peak } = salesBars(data.daily, period);
  const w = data.windows.find((x) => x.days === period) ?? data.windows[0];
  const unknown = bars.filter((b) => !b.known).length;
  const gap = period === 30 ? "gap-1" : period === 60 ? "gap-0.5" : "gap-px";
  return (
    <section id="sales" aria-labelledby="sales-h" className={`${CARD} flex scroll-mt-4 flex-col gap-3 px-5 py-[18px]`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="sales-h" className={H2}>
          Daily sales · {total.toLocaleString()} sold in {period} days
        </h2>
        <div role="group" aria-label="Period" className="flex gap-1">
          {PERIODS.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={period === n}
              onClick={() => setPeriod(n)}
              className={`cursor-pointer rounded-[7px] border px-2.5 py-[5px] font-[inherit] text-[13px] font-semibold ${period === n ? "border-ink bg-ink text-white" : "border-line-strong bg-white text-ink"}`}
            >
              {n} days
            </button>
          ))}
        </div>
      </div>
      <div
        role="img"
        aria-label={`Units sold per day over ${period} days: ${total} in total, never more than ${peak} a day${unknown ? `; no order history for the first ${unknown} days` : ""}`}
        className={`flex h-24 items-end border-b border-line ${gap}`}
      >
        {bars.map((b) => (
          <span
            key={b.date}
            title={`${shortDate(b.date)}: ${b.known ? `${b.units} sold` : "no order history yet"}`}
            className={`flex-1 rounded-t-[3px] ${!b.known ? "bg-head" : b.units > 0 ? "bg-accent" : "bg-line"}`}
            style={{ height: !b.known ? "100%" : b.units > 0 ? `${Math.max(6, b.height * 88)}px` : "2px" }}
          />
        ))}
      </div>
      {bars.length > 0 && (
        <div className="flex justify-between text-xs text-muted">
          <span>{shortDate(bars[0].date)}</span>
          <span>{shortDate(bars[Math.floor(bars.length / 2)].date)}</span>
          <span>{shortDate(bars.at(-1).date)}</span>
        </div>
      )}
      <p className="m-0 text-xs text-muted">
        {money.format(w.revenue)} revenue · {w.views.toLocaleString()} visits · {pct1(w.viewToCart)} view → cart · {pct1(w.viewToPurchase)} view → purchase
        {w.partial ? ` · only ${data.knownDays} days of order history known` : ""}
        {data.windows[2].views === 0 ? ". Visits come from Shopify analytics once view sync is connected." : "."}
      </p>
    </section>
  );
}

function Variants({ data, money }) {
  return (
    <section id="variants" aria-labelledby="var" className={`${CARD} scroll-mt-4 overflow-hidden`}>
      <h2 id="var" className={`${H2} px-5 pt-[18px] pb-2.5`}>
        Variants
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-[13px]">
          <thead>
            <tr className={`${THEAD} text-left`}>
              <th scope="col" className="py-2 pr-3 pl-5 font-semibold">
                Variant
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Stock
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Sold (60 days)
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Price
              </th>
              <th scope="col" className="py-2 pr-5 pl-3 text-right font-semibold">
                Cost
              </th>
            </tr>
          </thead>
          <tbody>
            {data.variants.map((v) => (
              <tr key={v.id} className={TROW}>
                <td className="py-[9px] pr-3 pl-5 font-semibold">
                  {variantName(v.options)}
                  {v.sku && <span className="ml-2 text-xs font-normal text-muted">{v.sku}</span>}
                </td>
                <td className={`px-3 py-[9px] text-right font-semibold tabular-nums ${v.stock <= 0 && !v.sellsWhenOut ? "text-[#B91C1C]" : ""}`}>
                  {v.stock <= 0 ? (v.sellsWhenOut ? `${v.stock} · sells on` : "0 · out") : v.stock.toLocaleString()}
                </td>
                <td className="px-3 py-[9px] text-right tabular-nums">{v.sold60.toLocaleString()}</td>
                <td className="px-3 py-[9px] text-right tabular-nums">{money.format(v.price)}</td>
                <td className="py-[9px] pr-5 pl-3 text-right tabular-nums">{v.cost == null ? "—" : money.format(v.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.windows[1].partial && <p className="m-0 border-t border-hair px-5 pt-2.5 pb-3.5 text-xs text-muted">Only {data.knownDays} days of order history are known so far.</p>}
    </section>
  );
}

function MarkdownSummary({ data, money }) {
  const card = markdownCard(data.markdown, data.variants, money);
  return (
    <ActionCard id="markdown" title="Markdown" state={card.state} stateClass={data.markdown.running ? "text-accent" : card.state === "Ready" ? "text-[#92400E]" : "text-muted"}>
      <p className="m-0 text-[13px] text-ink-2">{card.body}</p>
      <Link href={`/products/${data.product.id}/markdown`} className={`${BTN.small} mt-auto self-start`}>
        {card.cta}
      </Link>
    </ActionCard>
  );
}

/** How often the product comes back, against the store, and why. */
function Returns({ returns, money }) {
  const pctOf = (n) => (n == null ? "—" : returnPct(n));
  return (
    <ActionCard id="returns" title="Returns" state={`Last ${returns.days} days`}>
      <p className="m-0 text-[13px] text-ink-2">
        <strong>{pctOf(returns.rate)}</strong> came back ({returns.returned} of {returns.sold} units) · store average {pctOf(returns.storeRate)} · {money.format(returns.refunded)} refunded.
      </p>
      {returns.reasons.length > 0 && <p className="m-0 text-[13px] text-muted">Reasons: {returns.reasons.map((r) => `${r.name} (${r.count})`).join(", ")}</p>}
    </ActionCard>
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

/**
 * A rising star: how fast it grows and what to do so the growth lasts ("Done" starts measuring it), then
 * what was done and its sales since (units a day) against the 30 days before.
 */
function RisingStar({ productId, rising, trend, daysOfCover, actions, onChanged }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const measuring = actions.filter((a) => !a.done).map((a) => a.kind);
  async function done(kind) {
    setBusy(kind);
    setError(null);
    const res = await fetch(`/api/products/${productId}/rising-actions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }) }).catch(() => null);
    setBusy(null);
    if (!res?.ok) return setError((await res?.json().catch(() => ({})))?.error ?? "It couldn't be saved. Try again.");
    onChanged();
  }
  return (
    <ActionCard id="rising" title="Rising star" state={rising ? `${growthLabel(trend)} in 30 days` : "Actions"} stateClass="text-accent">
      {rising && (
        <>
          <p className="m-0 text-[13px] text-ink-2">Sales are up {growthLabel(trend)} over the 30 days before. Give it more visibility and keep it in stock.</p>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">
            {risingActions({ daysOfCover }).map((a) => (
              <li key={a.kind} className="flex items-start gap-2">
                {measuring.includes(a.kind) ? (
                  <span className="mt-0.5 flex-none text-xs font-semibold text-accent">Measuring</span>
                ) : (
                  <button type="button" disabled={busy !== null} onClick={() => done(a.kind)} className={`${BTN.tiny} cursor-pointer flex-none px-2 py-0.5 text-xs`}>
                    {busy === a.kind ? "Saving…" : "Done"}
                  </button>
                )}
                {a.href.startsWith("/") || a.href.startsWith("#") ? (
                  <Go href={a.href}>{a.text}</Go>
                ) : (
                  <a href={a.href} target="_top">
                    {a.text}
                  </a>
                )}
              </li>
            ))}
          </ul>
          <p className="m-0 text-xs text-muted">Press &quot;Done&quot; when you&apos;ve done one: its sales since are measured against the 30 days before.</p>
        </>
      )}
      {actions.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-0.5 border-t border-hair p-0 pt-2 text-[13px] text-ink-2">
          {actions.map((a) => (
            <li key={a.id}>
              <span className="font-semibold">{a.label}</span> on {a.startedOn}:{" "}
              {a.change == null
                ? a.days < 7
                  ? `measuring (day ${a.days + 1}; a result shows after 7 days).`
                  : `${a.after} a day since, no sales in the 30 days before to compare with.`
                : `${a.after} a day since vs ${a.before} before (${a.change >= 0 ? "+" : ""}${Math.round(a.change * 100)}%)${a.done ? ", over 30 days." : `, ${a.days} days so far.`}`}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="m-0 text-xs text-[#B91C1C]">{error}</p>}
    </ActionCard>
  );
}
