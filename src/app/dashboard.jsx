"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BTN, CARD, H2, PageHeader, Pill, TROW } from "@/app/ui/kit";
import { stuckSplit } from "@/lib/dashboard";
import { hasFeature, PLANS } from "@/lib/plans";
import { growthLabel } from "@/lib/rising";
import { daysPhrase, formatDays, moneyFormatter, STATUS_INFO } from "@/lib/status-info";

// The browser's locale, like the money amounts.
const percent = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 0 });
const count = new Intl.NumberFormat();
/** Small uppercase label (the design's "Money stuck in stock", "Next best move"). */
const LABEL = "m-0 text-xs font-semibold uppercase tracking-[0.06em] text-muted";
/** The design's dot color per status (the bar and the tiles). */
const DOT = {
  dead_stock: "bg-[#DC2626]",
  slow_mover: "bg-[#D97706]",
  page_problem: "bg-[#EA580C]",
  hidden_gem: "bg-[#0284C7]",
  stockout_risk: "bg-[#7C3AED]",
  new: "bg-[#9CA3AF]",
  healthy: "bg-[#059669]",
};
const TILE_STATUSES = ["dead_stock", "slow_mover", "page_problem", "hidden_gem", "stockout_risk", "new", "healthy"];

export function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  // Until the first analysis is finished, check again every few seconds so the dashboard appears by itself.
  useEffect(() => {
    let timer;
    const load = async () => {
      try {
        const res = await fetch("/api/dashboard");
        if (!res.ok) throw new Error(String(res.status));
        const body = await res.json();
        setData(body);
        setError(null);
        if (!body.imported) timer = setTimeout(load, 5000);
      } catch (e) {
        setError(e.message);
      }
    };
    load();
    return () => clearTimeout(timer);
  }, []);

  const header = <PageHeader title="Catalog health" />;
  if (error) return <>{header}<Notice tone="bad">Could not load the dashboard ({error}).</Notice></>;
  if (!data) return <>{header}<p className="m-0 text-muted">Loading the dashboard…</p></>;
  if (!data.imported) return <>{header}<Notice>Your dashboard appears here as soon as the first analysis of your store is finished.</Notice></>;
  if (data.productCount === 0) {
    return (
      <>
        {header}
        <Notice>
          No active products to analyze yet. Add products in Shopify (draft, archived and excluded products are left out, see Settings); new
          products are picked up at the next nightly analysis.
        </Notice>
      </>
    );
  }
  return <DashboardView data={data} />;
}

/** A plain message card (or a red one for errors). */
function Notice({ tone, children }) {
  return <p className={`m-0 rounded-xl border px-5 py-4 ${tone === "bad" ? "border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]" : "border-line bg-white text-ink-2"}`}>{children}</p>;
}

/** "Analyzed today at 06:02 · 248 active products". */
export function analyzedLine(scoredAt, productCount, now = new Date()) {
  if (!scoredAt) return `${count.format(productCount)} active products`;
  const at = new Date(scoredAt);
  const sameDay = at.toDateString() === now.toDateString();
  const time = at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const day = sameDay ? "today" : at.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `Analyzed ${day} at ${time} · ${count.format(productCount)} active product${productCount === 1 ? "" : "s"}`;
}

/** The catalog health screen for a store with analyzed products (the owner's design). */
export function DashboardView({ data }) {
  const money = moneyFormatter(data.currency);
  const attention = data.needsAttention;
  const starter = PLANS.find((p) => p.id === "starter");
  const showStarter = data.plan && !hasFeature(data.plan, "rescuePlans") && attention > 0;

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-[22px] font-bold tracking-[-0.01em]">Catalog health</h1>
          <p className="mt-0.5 mb-0 text-[13px] text-muted">{analyzedLine(data.scoredAt, data.productCount)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/products" className={BTN.secondary}>
            All products
          </Link>
          <Link href="/plan" className={BTN.primary}>
            This week&apos;s plan
          </Link>
        </div>
      </header>

      {data.overLimit > 0 && (
        <p className="m-0 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-accent-line bg-accent-soft px-[18px] py-3.5">
          <span>
            {count.format(data.overLimit)} more active product{data.overLimit === 1 ? " isn't" : "s aren't"} analyzed on your plan (the products with the
            most money in stock are analyzed first).
          </span>
          <Link href="/plans" className="font-semibold">
            See plans →
          </Link>
        </p>
      )}

      <ThisWeek week={data.week} money={money} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        <MoneyStuck data={data} money={money} />
        <NextMove
          item={data.top[0]}
          facts={data.nextMove}
          upNext={data.top.slice(1, 4)}
          of={data.top.length}
          attention={attention}
          newCount={data.byStatus.find((s) => s.status === "new")?.count ?? 0}
          money={money}
        />
      </div>

      {showStarter && (
        <p className="m-0 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-accent-line bg-accent-soft px-[18px] py-3.5">
          <span>
            <strong>
              {count.format(attention)} product{attention === 1 ? " needs" : "s need"} attention.
            </strong>{" "}
            Rescue plans, the fix center and the markdown engine start on {starter.name} (${starter.price}/month).
          </span>
          <Link href="/plans" className="font-semibold">
            See plans →
          </Link>
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <RisingStars rising={data.rising} />
        <RunningOut items={data.runningOut ?? []} total={data.runningOutCount ?? 0} />
      </div>

      <TopTable top={data.top} money={money} />
    </>
  );
}

/** "This week · 3 moves worth €3,060": the first moves of the week's plan. */
function ThisWeek({ week, money }) {
  if (!week?.actions?.length) return null;
  const worth = week.actions.reduce((s, a) => s + (a.moneyAtStake ?? 0), 0);
  return (
    <section aria-labelledby="wk" className={`${CARD} flex flex-col gap-2.5 px-5 py-4`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="wk" className={H2}>
          This week · {week.actions.length} move{week.actions.length === 1 ? "" : "s"}
          {worth > 0 ? ` worth ${money.format(worth)}` : ""}
        </h2>
        <Link href={`/plan?week=${week.week}`} className="text-[13px] font-semibold">
          Full weekly plan
        </Link>
      </div>
      <ol className="m-0 grid list-none grid-cols-1 gap-2.5 p-0 md:grid-cols-3">
        {week.actions.map((a, i) => (
          <li key={a.productId} className="flex items-start gap-2.5 rounded-[10px] border border-line px-3 py-2.5">
            <span className="grid h-[22px] w-[22px] flex-none place-items-center rounded-md bg-accent-soft text-xs font-bold text-accent">{i + 1}</span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <Link href={a.href} className="font-semibold text-ink no-underline hover:text-ink hover:underline">
                {a.title}
              </Link>
              <span className="text-[13px] text-muted">{a.text}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Money stuck in stock, the three key numbers, and products by status. */
function MoneyStuck({ data, money }) {
  const tiles = TILE_STATUSES.map((status) => data.byStatus.find((s) => s.status === status) ?? { status, count: 0, stockValue: 0 });
  const seasonal = data.byStatus.find((s) => s.status === "seasonal")?.count ?? 0;
  const shown = tiles.filter((t) => t.count > 0);
  const attentionShare = data.productCount > 0 ? data.needsAttention / data.productCount : 0;
  return (
    <section aria-labelledby="stuck" className={`${CARD} flex min-w-0 flex-col gap-[18px] px-6 py-[22px]`}>
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <h2 id="stuck" className={LABEL}>
            Money stuck in stock
          </h2>
          <p className="mt-1.5 mb-0 text-5xl leading-none font-bold tracking-[-0.02em] tabular-nums">{money.format(data.moneyStuck)}</p>
          <p className="mt-2.5 mb-0 max-w-[420px] text-ink-2">{stuckSentence(stuckSplit(data.byStatus))}</p>
        </div>
        <dl className="m-0 grid min-w-[230px] gap-1.5">
          <Stat label="Products analyzed" value={count.format(data.productCount)} />
          <Stat label="Need attention" value={`${count.format(data.needsAttention)}${data.needsAttention > 0 ? ` · ${percent.format(attentionShare)}` : ""}`} />
          <Stat label="Money at stake" value={money.format(data.moneyAtStakeTotal)} />
        </dl>
      </div>
      <div>
        <p className="mt-0 mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-muted">Products by status</p>
        {shown.length > 0 && (
          <div
            role="img"
            aria-label={`Products by status: ${shown.map((t) => `${count.format(t.count)} ${(STATUS_INFO[t.status]?.label ?? t.status).toLowerCase()}`).join(", ")}`}
            className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-canvas"
          >
            {shown.map((t) => (
              <span key={t.status} className={`min-w-1.5 ${DOT[t.status]}`} style={{ flex: `${t.count} 1 0` }} />
            ))}
          </div>
        )}
        <ul className="m-0 mt-3 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-4">
          {tiles.map((t) => (
            <li key={t.status}>
              <Link href={`/products?status=${t.status}`} className="block h-full rounded-[10px] border border-line px-[11px] py-[9px] text-ink no-underline hover:border-line-strong hover:text-ink">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-ink-2">
                  <span aria-hidden="true" className={`h-2 w-2 rounded-full ${DOT[t.status]}`} />
                  {STATUS_INFO[t.status]?.label ?? t.status}
                </span>
                <span className={`mt-0.5 block text-[22px] font-bold tabular-nums ${t.count === 0 ? "text-[#9CA3AF]" : ""}`}>{count.format(t.count)}</span>
                <span className="block text-xs text-muted">{money.format(t.stockValue)} in stock</span>
              </Link>
            </li>
          ))}
          <li>
            <Link
              href="/products?status=seasonal"
              className="box-border block h-full rounded-[10px] border border-dashed border-[#99D5CF] bg-[#F0FDFA] px-[11px] py-[9px] text-ink no-underline hover:text-ink"
            >
              <span className="flex items-center gap-1.5 text-xs font-semibold text-[#0F766E]">Seasonal · off season</span>
              <span className="mt-0.5 block text-[22px] font-bold tabular-nums">{count.format(seasonal)}</span>
              <span className="block text-xs text-ink-2">Not counted as stuck</span>
            </Link>
          </li>
        </ul>
      </div>
      <p className="m-0 text-xs text-muted">
        Stock value of dead stock and slow movers{data.moneyStuckIsEstimate ? " (estimated as price × 50% where cost is missing)" : ""}.
      </p>
    </section>
  );
}

/** One line on where the stuck money sits: dead stock, slow movers or both. */
function stuckSentence({ products, value, deadShare }) {
  if (!(value > 0)) {
    if (products === 0) return "Nothing is stuck right now: no dead stock and no slow movers.";
    return `${count.format(products)} dead-stock or slow-moving product${products === 1 ? "" : "s"}, but none holds stock value.`;
  }
  if (deadShare === 0) return "All of it sits with slow movers: products that sell, but too slowly for the stock you hold.";
  if (deadShare === 1) return "All of it is dead stock: products with no sale in a long time.";
  return `${share(deadShare)} is dead stock and ${share(1 - deadShare)} sits with slow movers.`;
}

/** A share between 0 and 1 that never rounds to 0% or 100%, so it can't contradict the tiles. */
const share = (x) => (x > 0 && x < 0.01 ? "<1%" : x < 1 && x > 0.99 ? ">99%" : percent.format(x));

function Stat({ label, value }) {
  return (
    <div className="flex justify-between gap-4 rounded-[10px] border border-line px-3 py-2">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="m-0 font-bold tabular-nums">{value}</dd>
    </div>
  );
}

/** "no sale in 142 days" ("in 1 day"); nothing when it sold today (or the days aren't known). */
export const noSaleFact = (days) => (days == null || days < 1 ? null : `no sale in ${count.format(days)} day${days === 1 ? "" : "s"}`);

/** What to do on the first product, by its status. */
function nextStep(item) {
  if (item.status === "stockout_risk") return { text: "See its stock →", href: `/products/${item.productId}#variants` };
  if (item.status === "hidden_gem") return { text: "Give it more visibility →", href: "/collections" };
  return { text: "Fix the page →", href: `/products/${item.productId}` };
}

/** The single product to start with (the first of the top 10), and the three after it. */
function NextMove({ item, facts, upNext, of, attention, newCount, money }) {
  if (!item) {
    return (
      <section aria-labelledby="nbm" className={`${CARD} flex min-w-0 flex-col justify-center gap-2 px-6 py-[22px]`}>
        <h2 id="nbm" className={LABEL}>
          Next best move
        </h2>
        <p className="m-0 text-[15px] font-bold">{attention === 0 ? "Nothing needs attention" : "No money at stake right now"}</p>
        <p className="m-0 text-[13px] text-muted">
          {attention === 0
            ? `${newCount > 0 ? `Every analyzed product is healthy, apart from ${count.format(newCount)} too new to judge.` : "Every analyzed product is healthy."} New problems show up here and in your inbox.`
            : "The products that need attention hold no stock value; see them in the product list."}
        </p>
      </section>
    );
  }
  const step = nextStep(item);
  const detail = [
    item.status === "stockout_risk" ? `${daysPhrase(item.daysOfCover)} of stock left` : "at stake",
    item.status !== "stockout_risk" ? noSaleFact(facts?.daysSinceSale) : null,
    facts?.imageCount != null ? `${facts.imageCount} photo${facts.imageCount === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  return (
    <section aria-labelledby="nbm" className={`${CARD} flex min-w-0 flex-col gap-4 px-6 py-[22px]`}>
      <div className="flex items-center justify-between gap-2">
        <h2 id="nbm" className={LABEL}>
          Next best move
        </h2>
        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">#1 of {of}</span>
      </div>
      <div className="flex items-center gap-3">
        <div aria-hidden="true" className="h-[52px] w-[52px] flex-none rounded-[10px] bg-[#E9EBEF]" />
        <div className="min-w-0">
          <Link href={`/products/${item.productId}`} className="text-[15px] font-bold text-ink no-underline hover:text-ink hover:underline">
            {item.title}
          </Link>
          <div className="mt-1">
            <Pill tone={item.status}>{STATUS_INFO[item.status]?.label ?? item.status}</Pill>
          </div>
        </div>
      </div>
      <div>
        {item.status !== "stockout_risk" && <p className="m-0 text-[30px] font-bold tracking-[-0.01em] tabular-nums">{money.format(item.moneyAtStake)}</p>}
        <p className="m-0 text-[13px] text-muted">{detail.join(" · ")}</p>
      </div>
      <Link href={step.href} className={BTN.block}>
        {step.text}
      </Link>
      {upNext.length > 0 && (
        <div className="border-t border-hair pt-3">
          <p className="mt-0 mb-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-muted">Up next</p>
          <ol className="m-0 flex list-none flex-col gap-1 p-0">
            {upNext.map((u, i) => (
              <li key={u.productId} className="flex items-center gap-2.5 py-[5px]">
                <span className="grid h-5 w-5 flex-none place-items-center rounded-[5px] bg-canvas text-[11px] font-bold text-muted">{i + 2}</span>
                <Link href={`/products/${u.productId}`} className="min-w-0 flex-1 truncate text-ink no-underline hover:text-ink hover:underline">
                  {u.title}
                </Link>
                <span className="font-semibold tabular-nums">{u.status === "stockout_risk" ? `${daysPhrase(u.daysOfCover)} left` : money.format(u.moneyAtStake)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

/** Rising stars: the fastest-growing three, with their conversion and a way to give them more room. */
function RisingStars({ rising }) {
  return (
    <section aria-labelledby="rising" className={`${CARD} flex flex-col gap-2.5 px-5 py-[18px]`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="rising" className={H2}>
          Rising stars
        </h2>
        {rising?.count > 0 && (
          <Link href="/products?rising=1" className="text-[13px] font-semibold">
            See all {count.format(rising.count)}
          </Link>
        )}
      </div>
      <p className="m-0 text-[13px] text-muted">Selling faster than the month before and converting at least as well as your store. Give them more attention.</p>
      {rising?.top?.length ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {rising.top.map((r) => (
            <li key={r.productId} className={`flex items-center gap-2.5 py-[9px] ${TROW}`}>
              <Link href={`/products/${r.productId}`} className="min-w-0 flex-1 truncate font-semibold text-ink no-underline hover:text-ink hover:underline">
                {r.title}
              </Link>
              <span className="text-[13px] font-semibold text-[#047857]">{growthLabel(r.trend)}</span>
              {r.conversion != null && <span className="text-[13px] text-muted">{(r.conversion * 100).toFixed(1)}% conv.</span>}
              <Link href="/collections" className={BTN.tiny}>
                Move to top
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className={`m-0 py-[9px] text-[13px] text-muted ${TROW}`}>No rising stars right now.</p>
      )}
    </section>
  );
}

/** Running out: stock-out risks with the fewest days of stock left. */
function RunningOut({ items, total }) {
  return (
    <section aria-labelledby="out" className={`${CARD} flex flex-col gap-2.5 px-5 py-[18px]`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="out" className={H2}>
          Running out
        </h2>
        {total > 0 && (
          <Link href="/products?status=stockout_risk" className="text-[13px] font-semibold">
            See all {count.format(total)}
          </Link>
        )}
      </div>
      <p className="m-0 text-[13px] text-muted">Products that sell well and will run out soon at today&apos;s pace. Reorder them in time.</p>
      {items.length ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {items.map((r) => (
            <li key={r.productId} className={`flex items-center gap-2.5 py-[9px] ${TROW}`}>
              <Link href={`/products/${r.productId}#variants`} className="min-w-0 flex-1 truncate font-semibold text-ink no-underline hover:text-ink hover:underline">
                {r.title}
              </Link>
              <span className="text-[13px] font-semibold text-[#B91C1C]">{daysPhrase(r.daysOfCover)} left</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={`m-0 py-[9px] text-[13px] text-muted ${TROW}`}>Nothing runs out soon.</p>
      )}
    </section>
  );
}

/** Days of stock: with stock but no sales in 30 days it lasts "over a year" (the design); no stock: "—". */
export const daysLabel = (r) => (r.daysOfCover != null ? formatDays(r.daysOfCover) : r.stockValue > 0 ? "over a year" : "—");

/** The top 10 to act on today. */
function TopTable({ top, money }) {
  return (
    <section aria-labelledby="top" className={`${CARD} overflow-hidden`}>
      <div className="px-5 pt-[18px] pb-2.5">
        <h2 id="top" className={H2}>
          Top 10 to act on today
        </h2>
        <p className="mt-0.5 mb-0 text-[13px] text-muted">Ranked by money at stake; stock-out risks keep 3 places, fewest days of stock first.</p>
      </div>
      {top.length === 0 ? (
        <p className={`m-0 px-5 py-3 text-[13px] text-muted ${TROW}`}>Nothing to act on right now.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-[13px]">
            <thead>
              <tr className="bg-head text-left text-muted">
                <th scope="col" className="w-9 py-[9px] pr-3 pl-5 font-semibold">
                  #
                </th>
                <th scope="col" className="px-3 py-[9px] font-semibold">
                  Product
                </th>
                <th scope="col" className="px-3 py-[9px] font-semibold">
                  Status
                </th>
                <th scope="col" className="px-3 py-[9px] text-right font-semibold">
                  Money at stake
                </th>
                <th scope="col" className="px-3 py-[9px] text-right font-semibold">
                  Days of stock
                </th>
                <th scope="col" className="py-[9px] pr-5 pl-3 font-semibold">
                  Next action
                </th>
              </tr>
            </thead>
            <tbody>
              {top.map((r, i) => (
                <tr key={r.productId} className={TROW}>
                  <td className="py-2.5 pr-3 pl-5 font-semibold text-muted">{i + 1}</td>
                  <td className="px-3 py-2.5">
                    <Link href={`/products/${r.productId}`} className="font-semibold text-ink no-underline hover:text-ink hover:underline">
                      {r.title}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5">
                    <Pill tone={r.status}>{STATUS_INFO[r.status]?.label ?? r.status}</Pill>
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{r.moneyAtStake > 0 ? money.format(r.moneyAtStake) : "—"}</td>
                  <td className="px-3 py-2.5 text-right text-ink-2 tabular-nums">{daysLabel(r)}</td>
                  <td className="py-2.5 pr-5 pl-3 text-ink-2">{STATUS_INFO[r.status]?.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={`m-0 px-5 pt-2.5 pb-3.5 text-xs text-muted ${TROW}`}>
        Money at stake = stock value × status weight (dead stock 100%, slow 70%, page problem 60%, hidden gem 40%).
      </p>
    </section>
  );
}
