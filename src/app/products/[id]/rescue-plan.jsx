"use client";

import { useState } from "react";
import { listen } from "@/app/polaris-events";

const VERDICTS = {
  improved: { label: "Improved", tone: "success", next: "Keep it as is; the product is back to daily monitoring." },
  no_change: { label: "No change", tone: "warning", next: "The fixes didn't move sales. Next step: a markdown plan." },
  worse: { label: "Worse", tone: "critical", next: "Undo the fixes, then look at the diagnosis again." },
  not_enough_data: { label: "Not enough data", tone: "info", next: "Too little data to judge the fixes (too few visits, or too little history before them)." },
  cancelled: { label: "Cancelled", tone: undefined, next: "All fixes in this plan were undone." },
};

const pct = (n) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${Math.round(n * 100)}%`);
const conv = (n) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);

/** The measurement window after fixes, and its verdict with the numbers and dates behind it. */
export function RescuePlan({ plan, onChanged }) {
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState(null);

  /** One-click undo of every fix in the plan (each restores its own snapshot). */
  async function undoAll() {
    if (undoing) return;
    setUndoing(true);
    setUndoError(null);
    for (const id of plan.fixIds) {
      const res = await fetch(`/api/fixes/${id}/undo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!res.ok && res.status !== 409) {
        setUndoError((await res.json().catch(() => ({}))).error ?? `Undo failed (${res.status})`);
        break;
      }
    }
    setUndoing(false);
    onChanged();
  }

  if (!plan.verdict) {
    const day = Math.max(1, plan.day);
    return (
      <s-section heading="Rescue plan">
        <s-stack gap="small">
          <s-badge tone="info">Measuring</s-badge>
          <s-text>
            Measuring the effect of {plan.fixes} fix{plan.fixes === 1 ? "" : "es"} since {plan.startedAt} (day {day}).{" "}
            {plan.hasViews
              ? `The window ends at 150 visits or ${plan.extended ? "60" : "30"} days, and not before 14 days.`
              : "The window runs 30 days (visit data isn't connected yet, so sales are compared)."}
          </s-text>
        </s-stack>
      </s-section>
    );
  }
  const v = VERDICTS[plan.verdict] ?? { label: plan.verdict, tone: undefined, next: "" };
  const r = plan.result;
  return (
    <s-section heading="Rescue plan">
      <s-stack gap="small">
        <s-badge tone={v.tone}>{v.label}</s-badge>
        <s-text>{v.next}</s-text>
        {plan.verdict === "worse" && plan.fixIds.length > 0 && (
          <div>
            <s-button variant="primary" loading={undoing || undefined} ref={listen("click", undoAll)}>
              Undo the fixes
            </s-button>
          </div>
        )}
        {undoError && <s-banner tone="critical">{undoError}</s-banner>}
        {r && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-zinc-500">
                <tr>
                  <th className="py-2 pr-4 font-medium" />
                  <th className="py-2 pr-4 font-medium">Before ({r.baselineWindow.from} – {r.baselineWindow.to})</th>
                  <th className="py-2 pr-4 font-medium">After ({r.window.from} – {r.window.to})</th>
                  <th className="py-2 font-medium">Change</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-zinc-200">
                  <td className="py-2 pr-4">Units</td>
                  <td className="py-2 pr-4">
                    {r.baselineRaw && r.baselineRaw.days !== r.baseline.days
                      ? `${r.baselineRaw.units} in ${r.baselineRaw.days} days, scaled to ${r.baseline.units}`
                      : r.baseline.units}{" "}
                    (expected now: {r.expectedUnits})
                  </td>
                  <td className="py-2 pr-4">{r.after.units}</td>
                  <td className="py-2">{pct(r.unitsChange)}</td>
                </tr>
                {r.basis === "conversion" && (
                  <>
                    <tr className="border-t border-zinc-200">
                      <td className="py-2 pr-4">Views</td>
                      <td className="py-2 pr-4">{r.baseline.views}</td>
                      <td className="py-2 pr-4">{r.after.views}</td>
                      <td className="py-2" />
                    </tr>
                    <tr className="border-t border-zinc-200">
                      <td className="py-2 pr-4">Conversion</td>
                      <td className="py-2 pr-4">{conv(r.baseline.conversion)}</td>
                      <td className="py-2 pr-4">{conv(r.after.conversion)}</td>
                      <td className="py-2">{pct(r.conversionChange)}</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        )}
        {r && (
          <s-text tone="neutral">
            Store-wide {r.basis === "conversion" ? "traffic" : "sales"} changed ×{r.trafficRatio.toFixed(2)} between the two periods; the
            expected units are scaled by that.{" "}
            {r.basis === "units" ? "Without view data, units are compared instead of conversion." : ""}
          </s-text>
        )}
      </s-stack>
    </s-section>
  );
}
