"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { listen } from "@/app/polaris-events";
import { UpgradeBanner } from "@/app/upgrade-banner";
import { monthRange } from "@/lib/report";
import { moneyFormatter } from "@/lib/status-info";

const monthName = (period) => new Date(`${period}-01T00:00:00Z`).toLocaleString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
const EFFECT = { improved: "Improved", no_change: "No change", worse: "Worse", not_enough_data: "Not enough data", cancelled: "Undone", measuring: "Measuring" };

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
  const period = asked && monthRange(asked) ? asked : months?.months[0];

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

  return (
    <s-page heading="Monthly report">
      <s-stack gap="base">
        <div>
          <Link href="/" className="text-sm text-zinc-600 hover:underline">
            ← Catalog health
          </Link>
        </div>
        {months && (
          <s-stack direction="inline" gap="small">
            {months.months.map((m) => (
              <s-button key={m} variant={m === period ? "secondary" : "tertiary"} ref={listen("click", () => router.replace(`/reports?period=${m}`))}>
                {monthName(m)}
                {m === months.current ? " (so far)" : ""}
              </s-button>
            ))}
          </s-stack>
        )}
        {upgrade && <UpgradeBanner>{upgrade}</UpgradeBanner>}
        {error && <s-banner tone="critical">Could not load the report ({error}).</s-banner>}
        {months && months.months.length === 0 && <s-banner tone="info">Your first report appears tomorrow, after the first complete day.</s-banner>}
        {!report && !error && !upgrade && months?.months.length !== 0 && <s-spinner accessibilityLabel="Loading report" />}

        {report && (
          <>
            {!report.complete && (
              <s-banner tone="info">
                {monthName(report.period)} so far: complete days up to {report.to}. Rescue plans count once their window ends.
              </s-banner>
            )}
            <s-section>
              <div className="grid gap-4 sm:grid-cols-2">
                <Headline
                  label="Revenue recovered"
                  value={money.format(report.revenueRecovered)}
                  formula="Per product: actual revenue − baseline daily revenue × days, never below 0. Periods: the measurement window of each rescue plan that improved (counted in the month it ends; baseline = its window before the fix) and each markdown's days this month (baseline = the 30 days before it started)."
                />
                <Headline
                  label="Stock value cleared"
                  value={`${money.format(report.stockValueCleared)}${report.stockValueIsEstimate ? " (partly estimated)" : ""}`}
                  formula="Units sold in those same periods × unit cost (50% of the sale price where no cost is set in Shopify)."
                />
                <Headline label="Products rescued" value={String(report.productsRescued)} formula="Products whose rescue plan's measurement window ended this month with the verdict “improved”." />
                <Headline
                  label="Fixes applied"
                  value={String(report.fixes.length)}
                  formula="Fixes applied to Shopify this month; the effect is the verdict of the rescue plan they belong to."
                />
              </div>
            </s-section>

            <s-section heading="Where the revenue came from">
              {report.rows.length === 0 ? (
                <s-paragraph>No rescue plan improved and no markdown ran in this month.</s-paragraph>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-zinc-500">
                      <tr>
                        <th className="py-2 pr-4 font-medium">Product</th>
                        <th className="py-2 pr-4 font-medium">Period</th>
                        <th className="py-2 pr-4 text-right font-medium">Revenue recovered</th>
                        <th className="py-2 pr-4 font-medium">= actual − baseline/day × days</th>
                        <th className="py-2 pr-4 text-right font-medium">Stock value cleared</th>
                        <th className="py-2 font-medium">= units × unit cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.rows.map((r) => (
                        <tr key={`${r.productId}-${r.kind}-${r.from}`} className="border-t border-zinc-200 align-top">
                          <td className="py-2 pr-4">
                            <Link href={`/products/${r.productId}`} className="hover:underline">
                              {r.title}
                            </Link>
                            <div className="text-xs text-zinc-500">{r.kind === "rescue" ? "Rescue plan (improved)" : "Markdown"}</div>
                          </td>
                          <td className="py-2 pr-4 whitespace-nowrap">
                            {r.from} → {r.to}
                            {r.skippedDays > 0 && <div className="text-xs text-zinc-500">{r.skippedDays} days already counted elsewhere</div>}
                            <div className="text-xs text-zinc-500">
                              {r.baselineFrom ? `Baseline ${r.baselineFrom} → ${r.baselineTo}` : "No baseline history"}
                            </div>
                          </td>
                          <td className="py-2 pr-4 text-right font-semibold">{money2.format(r.recovered)}</td>
                          <td className="py-2 pr-4 text-zinc-600">
                            {r.expected == null ? (
                              "No baseline known, so nothing counts as recovered"
                            ) : (
                              <>
                                {money2.format(r.actual)} − {money2.format(r.baselineDaily)} × {r.days} days ({money2.format(r.expected)}) ={" "}
                                {money2.format(r.actual - r.expected)}
                                {r.actual < r.expected ? " → 0" : ""}
                              </>
                            )}
                          </td>
                          <td className="py-2 pr-4 text-right">{money2.format(r.stockValueCleared)}</td>
                          <td className="py-2 text-zinc-600">
                            {r.units} × {money2.format(r.unitCost)}
                            {r.costIsEstimate ? " (est.)" : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </s-section>

            <s-section heading="Fixes applied">
              {report.fixes.length === 0 ? (
                <s-paragraph>No fixes were applied in this month.</s-paragraph>
              ) : (
                <ul className="m-0 list-none space-y-1 p-0 text-sm">
                  {report.fixes.map((f) => (
                    <li key={f.id} className="flex flex-wrap gap-2">
                      <span className="text-zinc-500">{f.appliedOn}</span>
                      <Link href={`/products/${f.productId}`} className="hover:underline">
                        {f.title}
                      </Link>
                      <span>{f.type}</span>
                      {f.status === "undone" && <s-badge>undone</s-badge>}
                      <span className="text-zinc-600">Effect: {EFFECT[f.effect] ?? "not measured"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </s-section>
          </>
        )}
      </s-stack>
    </s-page>
  );
}

function Headline({ label, value, formula }) {
  return (
    <div>
      <div className="text-sm text-zinc-500">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-xs text-zinc-500">{formula}</div>
    </div>
  );
}
