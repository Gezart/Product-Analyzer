"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BTN, CARD, H2, Notice, PageHeader, Pill, THEAD, TROW } from "@/app/ui/kit";
import { resultRow } from "@/lib/results";
import { moneyFormatter } from "@/lib/status-info";

const BAR = { rising: "bg-accent", good: "bg-[#059669]", neutral: "bg-[#9CA3AF]", bad: "bg-[#DC2626]" };

/** Results (the owner's design): every rescue plan, measuring or finished, and how its verdict is made. */
export function ResultsView() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/results")
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`);
        setData(body);
      })
      .catch((e) => setError(e.message));
  }, []);

  const header = <PageHeader title="Results" subtitle="Every fix and collection order is measured. Here is what worked." />;
  if (error) return <>{header}<Notice tone="bad">Could not load the results ({error}).</Notice></>;
  if (!data) return <>{header}<p className="m-0 text-muted">Loading the results…</p></>;

  const money = moneyFormatter(data.currency);
  // Counted in full on the server (the list below shows the newest plans).
  const summary = data.summary;
  const tiles = [
    { label: "Measuring now", value: summary.measuring, color: "text-accent" },
    { label: "Improved · 90 days", value: summary.improved, color: "text-[#047857]" },
    { label: "No change", value: summary.noChange, color: "text-ink" },
    { label: "Worse", value: summary.worse, color: "text-[#B91C1C]" },
  ];

  return (
    <>
      {header}
      <dl className="m-0 grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className={`${CARD} px-4 py-3.5`}>
            <dt className="text-xs text-muted">{t.label}</dt>
            <dd className={`mt-1 mb-0 text-2xl font-bold tabular-nums ${t.color}`}>{t.value}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="plans" className={`${CARD} overflow-hidden`}>
        <h2 id="plans" className={`${H2} px-5 pt-4 pb-2.5`}>
          Rescue plans
        </h2>
        {data.plans.length === 0 ? (
          <p className="m-0 px-5 pb-4 text-[13px] text-muted">
            No rescue plans yet. Each change you apply in a product&apos;s Fix center, or a new collection order, starts one. <Link href="/products">See your products</Link>
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-[13px]">
              <thead>
                <tr className={`${THEAD} text-left`}>
                  <th scope="col" className="py-2 pr-3 pl-5 font-semibold">
                    Product
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    What changed
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Window
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Conversion before → now
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Verdict
                  </th>
                  <th scope="col" className="py-2 pr-5 pl-3 font-semibold">
                    Next
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.plans.map((p) => {
                  const r = resultRow(p, { today: data.today, money });
                  return (
                    <tr key={p.id} className={TROW}>
                      <td className="px-5 py-2.5">
                        <Link href={`/products/${p.productId}`} className="font-semibold text-ink no-underline hover:text-ink hover:underline">
                          {p.title}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-ink-2">
                        {r.change}
                        <br />
                        <span className="text-xs text-muted">{r.started}</span>
                      </td>
                      <td className="min-w-[150px] px-3 py-2.5">
                        <div className="h-1.5 overflow-hidden rounded-full bg-hair" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(r.progress * 100)} aria-label="Window">
                          <div className={`h-full ${BAR[r.verdict.tone] ?? BAR.neutral}`} style={{ width: `${Math.round(r.progress * 100)}%` }} />
                        </div>
                        <span className="text-xs text-muted">{r.window}</span>
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">{r.conversion}</td>
                      <td className="px-3 py-2.5">
                        <Pill tone={r.verdict.tone}>{r.verdict.label}</Pill>
                      </td>
                      <td className="py-2.5 pr-5 pl-3">
                        {r.next?.cta && (
                          <Link href={r.next.href} className={BTN.tiny}>
                            {r.next.cta}
                          </Link>
                        )}
                        {r.next?.note && <span className="font-semibold text-[#047857]">{r.next.note}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="how" className={`${CARD} flex flex-col gap-2 px-5 py-4`}>
        <h2 id="how" className={H2}>
          How the verdict is made
        </h2>
        <ol className="m-0 flex list-decimal flex-col gap-1 pl-5 text-ink-2">
          <li>The window starts the day a change goes live and ends at 150 visits or 30 days, never before 14 days.</li>
          <li>The baseline is the same number of days before the change, adjusted for your whole store&apos;s traffic (between 0.5× and 2×), so seasons and ads don&apos;t skew it.</li>
          <li>Conversion up 20% or more, with more sold than expected: Improved. Down 20% or more: Worse. Otherwise: No change.</li>
          <li>
            Under 50 visits the window is extended once, to 60 days; still under 50, or less than 7 days of history before the change: Not enough data. Without visit data,
            units sold are compared against what was expected, in the same way.
          </li>
          <li>After Worse, undo the change on the product&apos;s page in one click (a collection order on the Collections page). After No change, the app suggests a markdown.</li>
        </ol>
      </section>
    </>
  );
}
