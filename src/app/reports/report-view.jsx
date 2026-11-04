"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CARD, H2, Notice, PageHeader, Pill, THEAD, TROW, UpgradeNotice } from "@/app/ui/kit";
import { returnPct } from "@/lib/diagnosis";
import { monthRange } from "@/lib/report";
import { moneyFormatter } from "@/lib/status-info";

const monthName = (period) => new Date(`${period}-01T00:00:00Z`).toLocaleString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
const FIX_LABEL = { title: "Title", description: "Description", seo: "SEO", images: "Image order", collection: "Collections", photo: "Photo added", position: "Collection position" };
const EFFECT = { improved: "Improved", no_change: "No change", worse: "Worse", not_enough_data: "Not enough data", cancelled: "Undone", measuring: "Measuring" };
const EFFECT_TONES = { improved: "good", worse: "bad", measuring: "rising" };

/** A month's results, with the formula next to every number. */
export function ReportView() {
  const router = useRouter();
  const params = useSearchParams();
  const [months, setMonths] = useState(null);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [upgrade, setUpgrade] = useState(null);

  useEffect(() => {
    fetch("/api/reports")
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (res.status === 403 && body.upgrade) return setUpgrade(body.error);
        if (!res.ok) throw new Error(String(res.status));
        setMonths(body);
      })
      .catch((e) => setError(e.message));
  }, []);
  const asked = params.get("period");
  // Fetched once the months are known (not at all when the plan doesn't include reports).
  const period = months ? (asked && monthRange(asked) ? asked : months.months[0]) : null;

  useEffect(() => {
    if (!period) return;
    let live = true;
    setReport(null);
    setError(null);
    fetch(`/api/reports/${period}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? String(res.status));
        if (live) setReport(body);
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [period]);

  const money = moneyFormatter(report?.currency ?? months?.currency);
  const money2 = moneyFormatter(report?.currency ?? months?.currency, 2);

  const header = (
    <PageHeader
      title={period ? `${monthName(period)}${months?.current === period ? " (so far)" : ""}` : "Monthly report"}
      subtitle="What Unstuck did for your store this month, with the formula under every number."
      actions={
        months?.months.length > 0 && (
          <>
            <label htmlFor="month" className="sr-only">
              Month
            </label>
            <select
              id="month"
              value={period ?? ""}
              onChange={(e) => router.replace(`/reports?period=${e.target.value}`)}
              className="rounded-lg border border-line-strong bg-white px-2.5 py-[9px] font-[inherit]"
            >
              {months.months.map((m) => (
                <option key={m} value={m}>
                  {monthName(m)}
                  {m === months.current ? " (so far)" : ""}
                </option>
              ))}
            </select>
          </>
        )
      }
    />
  );
  const total = (key) => (report?.rows ?? []).reduce((n, r) => n + (r[key] ?? 0), 0);

  return (
    <>
      {header}
      {upgrade && <UpgradeNotice>{upgrade}</UpgradeNotice>}
      {error && <Notice tone="bad">Could not load the report ({error}).</Notice>}
      {months && months.months.length === 0 && <Notice>Your first report appears tomorrow, after the first complete day.</Notice>}
      {!report && !error && !upgrade && months?.months.length !== 0 && <p className="m-0 text-muted">Loading the report…</p>}

      {report && (
        <>
          {!report.complete && (
            <Notice tone="info" compact>
              {monthName(report.period)} so far: complete days up to {report.to}. Rescue plans count once their window ends.
            </Notice>
          )}
          <dl className="m-0 grid gap-4 sm:grid-cols-2">
            <Headline
              label="Revenue recovered"
              value={money.format(report.revenueRecovered)}
              color="text-[#047857]"
              formula="Per product: actual revenue − baseline daily revenue × days, never below 0. Periods: the measurement window of each rescue plan that improved (counted in the month it ends; baseline = its window before the fix) and each markdown's days this month (baseline = the 30 days before it started)."
            />
            <Headline
              label="Stock value cleared"
              value={
                <>
                  {money.format(report.stockValueCleared)}
                  {report.stockValueIsEstimate && <span className="ml-2 text-[13px] font-semibold tracking-normal text-muted">partly estimated</span>}
                </>
              }
              formula="Units sold in those same periods × unit cost (50% of the sale price where no cost is set in Shopify)."
            />
            <Headline label="Products rescued" value={String(report.productsRescued)} formula="Products whose rescue plan's measurement window ended this month with the verdict “improved”." />
            <Headline
              label="Fixes applied"
              value={String(report.fixes.length)}
              formula={`Fixes applied to Shopify this month${report.fixes.some((f) => f.status === "undone") ? `, ${report.fixes.filter((f) => f.status === "undone").length} undone since` : ", none undone"}; the effect is the verdict of the rescue plan they belong to.`}
            />
          </dl>

          <section aria-labelledby="rows" className={`${CARD} overflow-hidden`}>
            <h2 id="rows" className={`${H2} px-5 pt-4 pb-2.5`}>
              Where the revenue came from
            </h2>
            {report.rows.length === 0 ? (
              <p className="m-0 px-5 pb-4 text-[13px] text-muted">No rescue plan improved and no markdown ran in this month.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-[13px]">
                  <thead>
                    <tr className={`${THEAD} text-left`}>
                      <th scope="col" className="py-2 pr-3 pl-5 font-semibold">
                        Product
                      </th>
                      <th scope="col" className="px-3 py-2 font-semibold">
                        Period
                      </th>
                      <th scope="col" className="px-3 py-2 font-semibold">
                        = actual − baseline/day × days
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">
                        Recovered
                      </th>
                      <th scope="col" className="py-2 pr-5 pl-3 text-right font-semibold">
                        Stock cleared
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((r) => (
                      <tr key={`${r.productId}-${r.kind}-${r.from}`} className={`${TROW} align-top`}>
                        <td className="py-2.5 pr-3 pl-5">
                          <Link href={`/products/${r.productId}`} className="font-semibold text-ink no-underline hover:text-ink hover:underline">
                            {r.title}
                          </Link>
                          <span className="block text-xs text-muted">{r.kind === "rescue" ? "Rescue plan (improved)" : "Markdown"}</span>
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {r.from} → {r.to}
                          {r.skippedDays > 0 && <span className="block text-xs text-muted">{r.skippedDays} days already counted elsewhere</span>}
                          <span className="block text-xs text-muted">{r.baselineFrom ? `Baseline ${r.baselineFrom} → ${r.baselineTo}` : "No baseline history"}</span>
                        </td>
                        <td className="px-3 py-2.5 text-ink-2">
                          {r.expected == null ? (
                            "No baseline known, so nothing counts as recovered"
                          ) : (
                            <>
                              {money2.format(r.actual)} − {money2.format(r.baselineDaily)} × {r.days} days ({money2.format(r.expected)}) = {money2.format(r.actual - r.expected)}
                              {r.actual < r.expected ? " → 0" : ""}
                            </>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right font-bold tabular-nums">{money2.format(r.recovered)}</td>
                        <td className="py-2.5 pr-5 pl-3 text-right tabular-nums">
                          {money2.format(r.stockValueCleared)}
                          <span className="block text-xs text-muted">
                            {r.units} × {money2.format(r.unitCost)}
                            {r.costIsEstimate ? " (est.)" : ""}
                          </span>
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-ink">
                      <th scope="row" colSpan={3} className="py-2.5 pr-3 pl-5 text-left">
                        Total
                      </th>
                      <td className="px-3 py-2.5 text-right font-bold tabular-nums">{money2.format(total("recovered"))}</td>
                      <td className="py-2.5 pr-5 pl-3 text-right font-bold tabular-nums">{money2.format(total("stockValueCleared"))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            <p className="m-0 border-t border-hair px-5 pt-2.5 pb-3.5 text-xs text-muted">Each rescue plan counts in full in the month it ends.</p>
          </section>

          {report.returns && <ReturnsSection returns={report.returns} money={money2} />}

          <section aria-labelledby="fixes" className={`${CARD} overflow-hidden`}>
            <h2 id="fixes" className={`${H2} px-5 pt-4 pb-2.5`}>
              Fixes applied
            </h2>
            {report.fixes.length === 0 ? (
              <p className="m-0 px-5 pb-4 text-[13px] text-muted">No fixes were applied in this month.</p>
            ) : (
              <ul className="m-0 list-none p-0 text-[13px]">
                {report.fixes.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-hair px-5 py-2.5">
                    <span className="w-24 flex-none text-muted tabular-nums">{f.appliedOn}</span>
                    <Link href={`/products/${f.productId}`} className="font-semibold text-ink no-underline hover:text-ink hover:underline">
                      {f.title}
                    </Link>
                    <span className="text-ink-2">{FIX_LABEL[f.type] ?? f.type}</span>
                    <span className="ml-auto">
                      <Pill tone={f.status === "undone" ? "neutral" : (EFFECT_TONES[f.effect] ?? "neutral")}>
                        {f.status === "undone" ? "Undone" : (EFFECT[f.effect] ?? "Not measured")}
                      </Pill>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}

/** What returns cost this month: refunds for orders placed in it, the top reasons and products. */
function ReturnsSection({ returns, money }) {
  return (
    <section aria-labelledby="returns" className={`${CARD} overflow-hidden`}>
      <h2 id="returns" className={`${H2} px-5 pt-4 pb-2.5`}>
        Returns
      </h2>
      {returns.returned === 0 ? (
        <div className="flex flex-col gap-1 px-5 pb-4 text-[13px]">
          <p className="m-0 text-ink-2">Nothing from this month&apos;s orders was refunded as a return.</p>
          {returns.reasons.length > 0 && <p className="m-0 text-muted">Return requests so far: {returns.reasons.map((r) => `${r.name} (${r.count})`).join(", ")}</p>}
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1 px-5 pb-3 text-[13px]">
            <p className="m-0 text-ink-2">
              <strong>{money.format(returns.refunded)}</strong> refunded for returns · {returns.returned} of {returns.sold} units came back ({returnPct(returns.rate ?? 0)}).
            </p>
            {returns.reasons.length > 0 && <p className="m-0 text-muted">Most common reasons: {returns.reasons.map((r) => `${r.name} (${r.count})`).join(", ")}</p>}
          </div>
          {returns.products.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] border-collapse text-[13px]">
                <thead>
                  <tr className={`${THEAD} text-left`}>
                    <th scope="col" className="py-2 pr-3 pl-5 font-semibold">
                      Product
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">
                      Came back
                    </th>
                    <th scope="col" className="py-2 pr-5 pl-3 text-right font-semibold">
                      Refunded
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {returns.products.map((p) => (
                    <tr key={p.productGid} className={TROW}>
                      <td className="py-2.5 pr-3 pl-5 font-semibold">
                        {p.productId ? (
                          <Link href={`/products/${p.productId}`} className="text-ink no-underline hover:text-ink hover:underline">
                            {p.title}
                          </Link>
                        ) : (
                          p.title
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {p.returned} of {p.sold} ({returnPct(p.rate ?? 0)})
                      </td>
                      <td className="py-2.5 pr-5 pl-3 text-right tabular-nums">{money.format(p.refunded)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <p className="m-0 border-t border-hair px-5 pt-2.5 pb-3.5 text-xs text-muted">
        Orders placed this month whose items were refunded as returns (cancellations aren&apos;t counted); amounts are the items&apos; prices, without tax or shipping. Reasons
        come from Shopify returns, including requests not refunded yet.
      </p>
    </section>
  );
}

function Headline({ label, value, formula, color = "text-ink" }) {
  return (
    <div className={`${CARD} flex flex-col gap-1 px-5 py-[18px]`}>
      <dt className="text-[13px] font-semibold text-muted">{label}</dt>
      <dd className={`m-0 text-[34px] font-bold tracking-[-0.01em] tabular-nums ${color}`}>{value}</dd>
      <dd className="m-0 border-t border-hair pt-2 text-xs text-muted">{formula}</dd>
    </div>
  );
}
