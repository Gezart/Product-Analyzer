"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { moneyFormatter, STATUS_INFO } from "@/lib/status-info";

const BUTTON = { reorder: "See stock", markdown: "Start the markdown", fix_page: "See why", visibility: "Collections", diagnose: "Diagnose" };
const VERDICT = {
  improved: { label: "Improved", tone: "success" },
  worse: { label: "Worse", tone: "critical" },
  no_change: { label: "No change", tone: "warning" },
  not_enough_data: { label: "Not enough data", tone: "info" },
};
const ENDED = { stock_cleared: "stock cleared", ladder_finished: "all steps done", cancelled: "stopped" };
const dayLabel = (key) => new Date(`${key}T00:00:00Z`).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** This week's plan: the 3–5 actions picked on Monday, each with a button to where it's done. */
export function WeeklyPlanView() {
  const router = useRouter();
  const params = useSearchParams();
  const week = params.get("week") ?? "";
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    setError(null);
    fetch(`/api/weekly-plan${week ? `?week=${encodeURIComponent(week)}` : ""}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`);
        if (live) setData(body);
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [week]);

  const money = moneyFormatter(data?.currency);
  const plan = data?.plan;

  return (
    <s-page heading="This week">
      <s-section>
        <s-stack gap="base">
          {error && <s-banner tone="critical">{error}</s-banner>}
          {!data && !error && <s-spinner accessibilityLabel="Loading the plan" />}
          {data && !plan && week && data.weeks.length > 0 && (
            <s-text>
              No plan is kept for that week.{" "}
              <Link href="/plan" className="underline">
                See the latest
              </Link>
            </s-text>
          )}
          {data && !plan && !(week && data.weeks.length > 0) && <s-text>No plan yet. Every Monday the most useful things to do that week show up here and in the inbox.</s-text>}
          {plan && (
            <>
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-text>Week of {dayLabel(plan.week)}</s-text>
                {data.weeks.length > 1 && (
                  <select
                    aria-label="Week"
                    className="rounded-lg border border-zinc-300 px-2 py-1 text-sm"
                    value={plan.week}
                    onChange={(e) => router.replace(`/plan?week=${e.target.value}`)}
                  >
                    {data.weeks.map((w) => (
                      <option key={w} value={w}>
                        {dayLabel(w)}
                      </option>
                    ))}
                  </select>
                )}
              </s-stack>
              {plan.actions.length === 0 && <s-text tone="neutral">Nothing urgent this week.</s-text>}
              <ol className="m-0 list-none space-y-3 p-0">
                {plan.actions.map((a, i) => (
                  <li key={a.productId} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-zinc-200 p-4">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="m-0 text-sm text-zinc-500">
                        {i + 1}. {STATUS_INFO[a.status]?.label ?? a.status}
                        {a.moneyAtStake > 0 ? ` · ${money.format(a.moneyAtStake)} at stake` : ""}
                      </p>
                      <p className="m-0 font-medium">
                        <Link href={`/products/${a.productId}`} className="underline">
                          {a.title}
                        </Link>
                      </p>
                      <p className="m-0 text-sm text-zinc-700">{a.text}</p>
                    </div>
                    <Link href={a.href} className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white">
                      {BUTTON[a.kind] ?? "Open"}
                    </Link>
                  </li>
                ))}
              </ol>
            </>
          )}
        </s-stack>
      </s-section>
      {plan?.lastWeek && <LastWeek recap={plan.lastWeek} money={money} />}
    </s-page>
  );
}

/** Last week's results: rescue verdicts (with the extra sales of improved ones) and markdowns. */
function LastWeek({ recap, money }) {
  const link = (p) => (
    <Link href={`/products/${p.productId}`} className="underline">
      {p.title}
    </Link>
  );
  return (
    <s-section heading="Last week">
      <s-stack gap="base">
        {recap.extraSales > 0 && <s-text>About {money.format(recap.extraSales)} in extra sales from products whose fixes worked.</s-text>}
        {recap.verdicts.length > 0 && (
          <ul className="m-0 list-none space-y-1.5 p-0 text-sm">
            {recap.verdicts.map((v) => (
              <li key={v.productId} className="flex flex-wrap items-center gap-2">
                <s-badge tone={VERDICT[v.verdict]?.tone}>{VERDICT[v.verdict]?.label ?? v.verdict}</s-badge>
                {link(v)}
                {v.extraUnits > 0 && (
                  <span className="text-zinc-500">
                    {v.extraUnits} more sold than expected (about {money.format(v.extraSales)})
                  </span>
                )}
                {v.verdict === "worse" && <span className="text-zinc-500">Undo the fixes on its page.</span>}
                {v.verdict === "no_change" && <span className="text-zinc-500">A markdown is proposed on its page.</span>}
              </li>
            ))}
          </ul>
        )}
        {(recap.markdownsStarted.length > 0 || recap.markdownsEnded.length > 0) && (
          <ul className="m-0 list-none space-y-1.5 p-0 text-sm">
            {recap.markdownsStarted.map((m) => (
              <li key={`s-${m.productId}`}>Markdown started: {link(m)}</li>
            ))}
            {recap.markdownsEnded.map((m) => (
              <li key={`e-${m.productId}`}>
                Markdown ended: {link(m)}
                {m.endReason ? ` (${ENDED[m.endReason] ?? m.endReason})` : ""}
              </li>
            ))}
          </ul>
        )}
      </s-stack>
    </s-section>
  );
}
