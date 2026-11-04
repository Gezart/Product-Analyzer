"use client";

import Link from "next/link";
import { useState } from "react";
import { BTN, Notice, THEAD, TROW } from "@/app/ui/kit";
import { ActionCard } from "./action-card";

const VERDICTS = {
  improved: { label: "Improved", color: "text-[#065F46]", next: "Keep it as is; the product is back to daily monitoring." },
  no_change: { label: "No change", color: "text-[#92400E]", next: "The fixes didn't move sales. Next step: a markdown plan." },
  worse: { label: "Worse", color: "text-[#B91C1C]", next: "Undo the fixes, then look at the diagnosis again." },
  not_enough_data: { label: "Not enough data", color: "text-muted", next: "Too little data to judge the fixes (too few visits, or too little history before them)." },
  cancelled: { label: "Cancelled", color: "text-muted", next: "All fixes in this plan were undone." },
};

const pct = (n) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${Math.round(n * 100)}%`);
const conv = (n) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);

const BODY = "m-0 text-[13px] text-ink-2";

/**
 * The rescue plan: not started (it starts with the first fix), measuring, or its verdict with the numbers
 * and dates behind it. `plan` is null when none has started.
 */
export function RescuePlan({ plan, productId, onChanged }) {
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState(null);

  if (!plan) {
    return (
      <ActionCard id="rescue" title="Rescue plan" state="Not started">
        <p className={BODY}>Starts when you apply a fix. Measures 14–30 days against your store&apos;s traffic and gives a verdict.</p>
        <Link href={`/products/${productId}/fix`} className={`${BTN.small} mt-auto self-start`}>
          Open Fix center
        </Link>
      </ActionCard>
    );
  }

  // New places in collections are undone on the Collections page (the whole order at once).
  const moves = plan.moves ?? [];
  const moveIds = new Set(moves.map((m) => m.fixId));
  const pageFixIds = plan.fixIds.filter((id) => !moveIds.has(id));
  const movesNote = moves.length > 0 && (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-[13px] text-muted">
      {moves.map((m) => (
        <li key={m.fixId}>
          Moved up in &quot;{m.collectionTitle}&quot;: from place {m.from} to {m.to}
          {m.status === "undone" ? " (undone)" : ""}.{" "}
          {m.collectionId && m.status === "applied" && (
            <Link href={`/collections?c=${m.collectionId}`} className="font-semibold">
              {plan.verdict === "worse" ? "Undo the new order" : "See the order"}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );

  /** One-click undo of every page fix in the plan (each restores its own snapshot). */
  async function undoAll() {
    if (undoing) return;
    setUndoing(true);
    setUndoError(null);
    for (const id of pageFixIds) {
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
      <ActionCard id="rescue" title="Rescue plan" state={`Measuring · day ${day}`} stateClass="text-accent">
        <p className={BODY}>
          Measuring the effect of {plan.fixes} fix{plan.fixes === 1 ? "" : "es"} since {plan.startedAt}.{" "}
          {plan.hasViews
            ? `The window ends at 150 visits or ${plan.extended ? "60" : "30"} days, and not before 14 days.`
            : "The window runs 30 days (visit data isn't connected yet, so sales are compared)."}
        </p>
        {movesNote}
      </ActionCard>
    );
  }
  const v = VERDICTS[plan.verdict] ?? { label: plan.verdict, color: "text-muted", next: "" };
  const r = plan.result;
  return (
    <ActionCard id="rescue" title="Rescue plan" state={v.label} stateClass={v.color} wide={Boolean(r)}>
      <p className={BODY}>{v.next}</p>
      {movesNote}
      {plan.verdict === "worse" && pageFixIds.length > 0 && (
        <button type="button" disabled={undoing} onClick={undoAll} className={`${BTN.smallPrimary} cursor-pointer self-start`}>
          {undoing ? "Undoing…" : "Undo the fixes"}
        </button>
      )}
      {undoError && <Notice tone="bad" className="px-4 py-3 text-[13px]">{undoError}</Notice>}
      {r && (
        <div className="-mx-[18px] overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-[13px]">
            <thead>
              <tr className={`${THEAD} text-left`}>
                <th scope="col" className="py-2 pr-3 pl-[18px] font-semibold" />
                <th scope="col" className="px-3 py-2 font-semibold">
                  Before ({r.baselineWindow.from} – {r.baselineWindow.to})
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  After ({r.window.from} – {r.window.to})
                </th>
                <th scope="col" className="py-2 pr-[18px] pl-3 font-semibold">
                  Change
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className={TROW}>
                <th scope="row" className="py-2 pr-3 pl-[18px] text-left font-semibold">
                  Units
                </th>
                <td className="px-3 py-2">
                  {r.baselineRaw && r.baselineRaw.days !== r.baseline.days ? `${r.baselineRaw.units} in ${r.baselineRaw.days} days, scaled to ${r.baseline.units}` : r.baseline.units} (expected now:{" "}
                  {r.expectedUnits})
                </td>
                <td className="px-3 py-2">{r.after.units}</td>
                <td className="py-2 pr-[18px] pl-3 font-semibold">{pct(r.unitsChange)}</td>
              </tr>
              {r.basis === "conversion" && (
                <>
                  <tr className={TROW}>
                    <th scope="row" className="py-2 pr-3 pl-[18px] text-left font-semibold">
                      Views
                    </th>
                    <td className="px-3 py-2">{r.baseline.views}</td>
                    <td className="px-3 py-2">{r.after.views}</td>
                    <td className="py-2 pr-[18px] pl-3" />
                  </tr>
                  <tr className={TROW}>
                    <th scope="row" className="py-2 pr-3 pl-[18px] text-left font-semibold">
                      Conversion
                    </th>
                    <td className="px-3 py-2">{conv(r.baseline.conversion)}</td>
                    <td className="px-3 py-2">{conv(r.after.conversion)}</td>
                    <td className="py-2 pr-[18px] pl-3 font-semibold">{pct(r.conversionChange)}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      )}
      {r && (
        <p className="m-0 text-xs text-muted">
          Store-wide {r.basis === "conversion" ? "traffic" : "sales"} changed ×{r.trafficRatio.toFixed(2)} between the two periods; the expected units are scaled by that.
          {r.basis === "units" ? " Without view data, units are compared instead of conversion." : ""}
        </p>
      )}
    </ActionCard>
  );
}
