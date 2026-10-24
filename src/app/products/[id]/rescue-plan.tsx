"use client";

type Totals = { days: number; units: number; views: number; purchases: number; conversion: number | null };
type Result = {
  verdict: string;
  basis: "conversion" | "units";
  window: { from: string; to: string };
  baselineWindow: { from: string; to: string };
  after: Totals;
  baseline: Totals;
  trafficRatio: number;
  expectedUnits: number;
  conversionChange: number | null;
  unitsChange: number | null;
};
export type RescuePlanData = {
  startedAt: string;
  endsAt: string | null;
  verdict: string | null;
  fixes: number;
  extended: boolean;
  result: Result | null;
};

const VERDICTS: Record<string, { label: string; tone: string; next: string }> = {
  improved: { label: "Improved", tone: "success", next: "Keep it as is; the product is back to daily monitoring." },
  no_change: { label: "No change", tone: "warning", next: "The fixes didn't move sales. Next step: a markdown plan." },
  worse: { label: "Worse", tone: "critical", next: "Undo the fixes in the fix center below, then look at the diagnosis again." },
  not_enough_data: { label: "Not enough data", tone: "info", next: "Too few visits to judge, even after extending the window." },
  cancelled: { label: "Cancelled", tone: undefined as unknown as string, next: "All fixes in this plan were undone." },
};

const pct = (n: number | null) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${Math.round(n * 100)}%`);
const conv = (n: number | null) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);

/** The measurement window after fixes, and its verdict with the numbers and dates behind it. */
export function RescuePlan({ plan }: { plan: RescuePlanData }) {
  if (!plan.verdict) {
    const day = Math.max(1, Math.round((Date.now() - Date.parse(plan.startedAt)) / 86_400_000));
    return (
      <s-section heading="Rescue plan">
        <s-stack gap="small">
          <s-badge tone="info">Measuring</s-badge>
          <s-text>
            Measuring the effect of {plan.fixes} fix{plan.fixes === 1 ? "" : "es"} since {plan.startedAt} (day {day}). The window ends at 150
            visits or {plan.extended ? "60" : "30"} days, and not before 14 days.
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
                    {r.baseline.units} (expected now: {r.expectedUnits})
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
