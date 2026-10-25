"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CARD, EYEBROW, PRIMARY_LINK, statusStyle } from "@/app/status-style";
import { UpgradeBanner } from "@/app/upgrade-banner";
import { stuckSplit } from "@/lib/dashboard";
import { hasFeature, PLANS } from "@/lib/plans";
import { moneyFormatter, STATUS_INFO } from "@/lib/status-info";

const percent = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 0 });
const count = new Intl.NumberFormat();

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

  if (error) return <s-banner tone="critical">Could not load the dashboard ({error}).</s-banner>;
  if (!data) return <s-spinner accessibilityLabel="Loading dashboard" />;
  if (!data.imported) {
    return (
      <s-section>
        <s-paragraph>Your dashboard appears here as soon as the first analysis of your store is finished.</s-paragraph>
      </s-section>
    );
  }
  if (data.productCount === 0) {
    return (
      <s-section>
        <s-paragraph>
          No active products to analyze yet. Add products in Shopify (draft, archived and excluded products are left out, see Settings); new
          products are picked up at the next nightly analysis.
        </s-paragraph>
      </s-section>
    );
  }
  return <DashboardView data={data} />;
}

/** The catalog health screen for a store with analyzed products. */
export function DashboardView({ data }) {
  const money = moneyFormatter(data.currency);
  const attention = data.needsAttention;
  const atStake = data.moneyAtStakeTotal;
  const starter = PLANS.find((p) => p.id === "starter");
  const showStarter = data.plan && !hasFeature(data.plan, "rescuePlans") && attention > 0;

  return (
    <div className="@container w-full">
      <s-stack gap="base">
        {data.overLimit > 0 && (
          <UpgradeBanner>
            {data.overLimit} more active product{data.overLimit === 1 ? " isn't" : "s aren't"} analyzed on your plan (the products with the most money
            in stock are analyzed first).
          </UpgradeBanner>
        )}

        <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
          <Hero data={data} money={money} attention={attention} atStake={atStake} />
          <NextMove item={data.top[0]} upNext={data.top.slice(1, 4)} attention={attention} money={money} />
        </div>

        {showStarter && (
          <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-indigo-200 bg-linear-to-r from-indigo-50 via-white to-white px-5 py-4">
            <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-100 text-indigo-600">
              <SparkIcon />
            </span>
            <p className="min-w-60 flex-1 text-sm text-zinc-600">
              <span className="font-semibold text-zinc-900">
                {count.format(attention)} product{attention === 1 ? " needs" : "s need"} attention.
              </span>{" "}
              Rescue plans, the fix center and the markdown engine start on {starter.name} (${starter.price}/month).
            </p>
            <Link href="/plans" className={PRIMARY_LINK}>
              See plans
            </Link>
          </div>
        )}

        <TopTable top={data.top} money={money} />
      </s-stack>
    </div>
  );
}

function Hero({ data, money, attention, atStake }) {
  const attentionShare = data.productCount > 0 ? attention / data.productCount : 0;
  return (
    <section className={`${CARD} @container relative overflow-hidden p-6`}>
      <div aria-hidden="true" className="pointer-events-none absolute -top-28 -right-24 h-72 w-72 rounded-full bg-indigo-400/20 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-36 -left-24 h-72 w-72 rounded-full bg-amber-300/25 blur-3xl" />
      <div className="relative">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={EYEBROW}>Money stuck in stock</p>
          {data.scoredAt && (
            <p className="text-xs text-zinc-500">
              Analyzed {new Date(data.scoredAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
            </p>
          )}
        </div>

        <div className="mt-3 grid gap-6 @2xl:grid-cols-[minmax(0,1fr)_auto] @2xl:items-end">
          <div>
            <p className="text-5xl font-bold tracking-tight text-zinc-900 tabular-nums @xl:text-6xl">{money.format(data.moneyStuck)}</p>
            <p className="mt-3 max-w-md text-sm text-zinc-600">{stuckSentence(stuckSplit(data.byStatus))}</p>
          </div>
          <dl className="grid gap-2 @2xl:min-w-60">
            <Stat label="Products analyzed" value={count.format(data.productCount)} />
            <Stat label="Need attention" value={count.format(attention)} extra={attention > 0 ? percent.format(attentionShare) : null} />
            <Stat label="Money at stake" value={money.format(atStake)} />
          </dl>
        </div>

        <StatusMix byStatus={data.byStatus} money={money} />

        <p className="mt-4 text-xs text-zinc-500">
          Stock value of dead stock and slow movers
          {data.moneyStuckIsEstimate ? " (estimated where product cost is missing: price × 50%)" : ""}.
        </p>
      </div>
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

function Stat({ label, value, extra }) {
  return (
    <div className="flex items-baseline justify-between gap-6 rounded-xl border border-zinc-200 bg-white/70 px-3.5 py-2.5 backdrop-blur">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="m-0 whitespace-nowrap text-base font-semibold text-zinc-900 tabular-nums">
        {value}
        {extra && <span className="ml-1.5 text-xs font-semibold text-amber-700">{extra}</span>}
      </dd>
    </div>
  );
}

/** Products per status: one stacked bar plus a tile per status. */
function StatusMix({ byStatus, money }) {
  const total = byStatus.reduce((n, s) => n + s.count, 0);
  const shown = byStatus.filter((s) => s.count > 0);
  return (
    <div className="mt-6">
      <p className={EYEBROW}>Products by status</p>
      {total > 0 && (
        <div
          role="img"
          aria-label={shown.map((s) => `${STATUS_INFO[s.status]?.label ?? s.status}: ${s.count}`).join(", ")}
          className="mt-2 flex h-3 gap-0.5 overflow-hidden rounded-full bg-zinc-100"
        >
          {shown.map((s) => (
            <div
              key={s.status}
              title={`${STATUS_INFO[s.status]?.label ?? s.status}: ${s.count} (${percent.format(s.count / total)})`}
              className={`${statusStyle(s.status).bar} min-w-1.5`}
              style={{ flexGrow: s.count, flexBasis: 0 }}
            />
          ))}
        </div>
      )}
      <ul className="m-0 mt-4 grid list-none grid-cols-2 gap-2 p-0 @lg:grid-cols-3 @3xl:grid-cols-6">
        {byStatus.map((s) => {
          const info = STATUS_INFO[s.status];
          const empty = s.count === 0;
          return (
            <li
              key={s.status}
              className={`rounded-xl border px-3 py-2.5 ${empty ? "border-dashed border-zinc-200" : "border-zinc-200 bg-white/70"}`}
            >
              <div className="flex items-center gap-2 text-xs font-medium text-zinc-600">
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 shrink-0 rounded-full ${empty ? "ring-2 ring-zinc-300 ring-inset" : statusStyle(s.status).bar}`}
                />
                <span className="truncate">{info?.label ?? s.status}</span>
              </div>
              <div className={`mt-1 text-2xl font-semibold tabular-nums ${empty ? "text-zinc-300" : "text-zinc-900"}`}>{count.format(s.count)}</div>
              <div className="text-xs leading-snug text-zinc-500">
                {money.format(s.stockValue)} in stock
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The single product to start with: the first of the top 10. */
function NextMove({ item, upNext, attention, money }) {
  if (!item) {
    return (
      <section className={`${CARD} flex flex-col items-start justify-center gap-3 p-6`}>
        <span aria-hidden="true" className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
          <CheckIcon />
        </span>
        {attention === 0 ? (
          <>
            <p className="m-0 text-base font-semibold text-zinc-900">Nothing needs attention</p>
            <p className="m-0 text-sm text-zinc-600">Every analyzed product is healthy. New problems show up here and in your inbox.</p>
          </>
        ) : (
          <>
            <p className="m-0 text-base font-semibold text-zinc-900">No money at stake right now</p>
            <p className="m-0 text-sm text-zinc-600">
              {count.format(attention)} product{attention === 1 ? " needs" : "s need"} a look (see the status tiles), but none holds stock at risk.
            </p>
          </>
        )}
      </section>
    );
  }
  const info = STATUS_INFO[item.status];
  const style = statusStyle(item.status);
  const href = `/products/${item.productId}`;
  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-5 p-6`}>
      <div className="flex items-center justify-between gap-2">
        <p className={EYEBROW}>Next best move</p>
        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">#1 of your top 10</span>
      </div>
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${style.soft} ${style.text}`}>
          <BoxIcon />
        </span>
        <div className="min-w-0">
          <Link href={href} className="line-clamp-2 font-semibold text-zinc-900 hover:underline">
            {item.title}
          </Link>
          <div className="mt-1">
            <s-badge tone={info?.tone}>{info?.label ?? item.status}</s-badge>
          </div>
        </div>
      </div>
      {item.moneyAtStake > 0 ? (
        <div>
          <p className="m-0 text-3xl font-bold tracking-tight text-zinc-900 tabular-nums">{money.format(item.moneyAtStake)}</p>
          <p className="m-0 text-sm text-zinc-500">at stake</p>
        </div>
      ) : item.daysOfCover != null ? (
        <div>
          <p className="m-0 text-3xl font-bold tracking-tight text-zinc-900 tabular-nums">{count.format(Math.round(item.daysOfCover))} days</p>
          <p className="m-0 text-sm text-zinc-500">of stock left</p>
        </div>
      ) : null}
      <Link href={href} className={`${PRIMARY_LINK} w-full`}>
        {info?.action ?? "Open product"}
        <span aria-hidden="true">→</span>
      </Link>
      {upNext.length > 0 && (
        <div className="mt-auto border-t border-zinc-100 pt-4">
          <p className={EYEBROW}>Up next</p>
          <ol className="m-0 mt-2 list-none space-y-1 p-0">
            {upNext.map((r, i) => (
              <li key={r.productId}>
                <Link
                  href={`/products/${r.productId}`}
                  className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-zinc-50"
                >
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-zinc-100 text-[11px] font-semibold text-zinc-500">{i + 2}</span>
                  <span className="min-w-0 flex-1 truncate text-zinc-800">{r.title}</span>
                  <span className="shrink-0 font-semibold text-zinc-900 tabular-nums">
                    {r.moneyAtStake > 0 ? money.format(r.moneyAtStake) : STATUS_INFO[r.status]?.label}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

function TopTable({ top, money }) {
  const max = Math.max(0, ...top.map((r) => r.moneyAtStake)) || 1;
  const showDays = top.some((r) => r.daysOfCover != null);
  return (
    <section className={`${CARD} overflow-hidden`}>
      <div className="px-5 pt-5 pb-3">
        <h2 className="m-0 text-base font-semibold text-zinc-900">Top 10 to act on today</h2>
        <p className="m-0 mt-0.5 text-sm text-zinc-500">Ranked by money at stake; stock-out risks follow, fewest days of stock first.</p>
      </div>
      {top.length === 0 ? (
        <p className="m-0 px-5 pb-5 text-sm text-zinc-600">No product has money at stake or a stock-out coming right now.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs text-zinc-500">
              <tr className="border-y border-zinc-200">
                <th scope="col" className="hidden w-12 py-2.5 pr-2 pl-5 font-medium @xl:table-cell">
                  #
                </th>
                <th scope="col" className="py-2.5 pr-4 pl-5 font-medium @xl:pl-0">
                  Product
                </th>
                <th scope="col" className="hidden py-2.5 pr-4 font-medium @3xl:table-cell">
                  Status
                </th>
                <th scope="col" className="py-2.5 pr-5 text-right font-medium @4xl:pr-4">
                  Money at stake
                </th>
                {showDays && (
                  <th scope="col" className="hidden py-2.5 pr-4 text-right font-medium @lg:table-cell">
                    Days of stock
                  </th>
                )}
                <th scope="col" className="hidden py-2.5 pr-5 font-medium @4xl:table-cell">
                  Next action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {top.map((r, i) => {
                const info = STATUS_INFO[r.status];
                const href = `/products/${r.productId}`;
                return (
                  <tr key={r.productId} className="group transition-colors hover:bg-zinc-50">
                    <td className="hidden py-3 pr-2 pl-5 @xl:table-cell">
                      <span
                        className={`grid h-6 w-6 place-items-center rounded-md text-xs font-semibold ${i < 3 ? "bg-indigo-50 text-indigo-700" : "bg-zinc-100 text-zinc-500"}`}
                      >
                        {i + 1}
                      </span>
                    </td>
                    <td className="py-3 pr-4 pl-5 @xl:pl-0">
                      <Link href={href} className="block min-w-32 font-medium text-zinc-900 hover:underline @xl:min-w-40">
                        {r.title}
                      </Link>
                      <span className="mt-0.5 block text-xs text-zinc-500 @3xl:hidden">
                        <span aria-hidden="true" className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${statusStyle(r.status).bar}`} />
                        {info?.label ?? r.status}
                        {r.daysOfCover != null && <span className="@lg:hidden"> · {count.format(Math.round(r.daysOfCover))} days of stock</span>}
                      </span>
                    </td>
                    <td className="hidden py-3 pr-4 whitespace-nowrap @3xl:table-cell">
                      <s-badge tone={info?.tone}>{info?.label ?? r.status}</s-badge>
                    </td>
                    <td className="py-3 pr-5 text-right @4xl:pr-4">
                      <div className="ml-auto flex w-24 flex-col items-end gap-1.5 @xl:w-36">
                        <span className="font-semibold text-zinc-900 tabular-nums">{r.moneyAtStake > 0 ? money.format(r.moneyAtStake) : "—"}</span>
                        <span aria-hidden="true" className="flex h-1.5 w-full justify-end overflow-hidden rounded-full bg-zinc-100">
                          <span className={`h-full rounded-full ${statusStyle(r.status).bar}`} style={{ width: `${(r.moneyAtStake / max) * 100}%` }} />
                        </span>
                      </div>
                    </td>
                    {showDays && (
                      <td className="hidden py-3 pr-4 text-right text-zinc-700 tabular-nums @lg:table-cell">
                        {r.daysOfCover == null ? "—" : count.format(Math.round(r.daysOfCover))}
                      </td>
                    )}
                    <td className="hidden py-3 pr-5 @4xl:table-cell">
                      <Link
                        href={href}
                        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-semibold text-zinc-700 transition group-hover:border-indigo-300 group-hover:text-indigo-700"
                      >
                        {info?.action ?? "Open product"}
                        <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">
                          →
                        </span>
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="m-0 border-t border-zinc-100 px-5 py-3 text-xs text-zinc-500">
        Money at stake = stock value × status weight (dead stock 100%, slow 70%, page problem 60%, hidden gem 40%).
      </p>
    </section>
  );
}

function BoxIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 8l-9-5-9 5 9 5 9-5z" />
      <path d="M3 8v8l9 5 9-5V8" />
      <path d="M12 13v8" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.9 4.6 4.6 1.9-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z" />
      <path d="M19 15l.8 1.9 1.9.8-1.9.8L19 20.4l-.8-1.9-1.9-.8 1.9-.8z" />
    </svg>
  );
}
