"use client";

import { useEffect, useState } from "react";
import { apiError } from "@/app/api-error";
import { CARD, H2, Notice, THEAD, TROW } from "@/app/ui/kit";

/** Plans (the owner's design): the four plans as cards and what each includes every month. */
export function PlanPicker() {
  const [plans, setPlans] = useState([]);
  const [current, setCurrent] = useState(null);
  const [trialDays, setTrialDays] = useState(0);
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);
  const [syncError, setSyncError] = useState(null);
  const [confirmFree, setConfirmFree] = useState(false);

  async function load() {
    const res = await fetch("/api/billing");
    if (!res.ok) throw await apiError(res);
    const data = await res.json();
    setPlans(data.plans);
    setCurrent(data.current);
    setTrialDays(data.trialDays);
    setSyncError(data.syncError ?? null);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function choose(planId) {
    // Going to Free cancels the paid subscription right away: ask once more.
    if (planId === "free" && !confirmFree) return setConfirmFree(true);
    setConfirmFree(false);
    setPending(planId);
    setError(null);
    try {
      const res = await fetch("/api/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planId }),
      });
      if (!res.ok) throw await apiError(res);
      const { confirmationUrl } = await res.json();
      // Shopify's approval page must open in the top window, outside the iframe.
      if (confirmationUrl) window.open(confirmationUrl, "_top");
      else await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setPending(null);
    }
  }

  if (!current && error) return <Notice tone="bad">Could not load plans: {error}</Notice>;
  if (!current) return <p className="m-0 text-muted">Loading plans…</p>;

  return (
    <>
      {error && <Notice tone="bad">{error}</Notice>}
      {syncError && <Notice tone="warn">{syncError} Showing the plan last saved; changing plans needs Shopify.</Notice>}
      <PlanCards plans={plans} current={current} trialDays={trialDays} pending={pending} confirmFree={confirmFree} onChoose={choose} />
      <Limits plans={plans} />
    </>
  );
}

const CHECK = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#047857" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-[3px] flex-none">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

/** Plan cards; the plan right above the current one is marked as the recommended next step. */
export function PlanCards({ plans, current, trialDays, pending, confirmFree = false, onChoose }) {
  const currentIndex = plans.findIndex((p) => p.id === current);
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {plans.map((plan, i) => {
        const isCurrent = plan.id === current;
        const isNext = currentIndex >= 0 && i === currentIndex + 1;
        const edge = isCurrent ? "border-2 border-[#059669]" : isNext ? "border-2 border-accent" : "border border-line";
        const cta = isCurrent
          ? "cursor-default border-0 bg-canvas text-muted"
          : isNext
            ? "border-0 bg-ink text-white hover:bg-black"
            : plan.price === 0 && confirmFree
              ? "border border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]"
              : "border border-line-strong bg-white text-ink hover:bg-head";
        return (
          <section key={plan.id} aria-labelledby={`plan-${plan.id}`} className={`flex min-w-0 flex-col gap-3 rounded-xl bg-white p-[18px] ${edge}`}>
            <div className="flex min-h-[22px] items-center justify-between gap-1.5">
              <h2 id={`plan-${plan.id}`} className="m-0 text-base font-bold">
                {plan.name}
              </h2>
              {isCurrent ? (
                <span className="rounded-full bg-[#D1FAE5] px-2 py-0.5 text-[11px] font-bold text-[#065F46]">Current plan</span>
              ) : isNext ? (
                <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-white">Recommended</span>
              ) : null}
            </div>
            <p className="m-0 text-[30px] font-bold tracking-[-0.01em] tabular-nums">
              ${plan.price}
              {plan.price > 0 && <span className="text-[13px] font-medium tracking-normal text-muted">/month</span>}
            </p>
            <p className="m-0 rounded-lg bg-head px-2.5 py-2 text-[13px] font-semibold">
              {Number.isFinite(plan.products) && plan.products ? `${plan.products.toLocaleString("en-US")} products analyzed` : "Unlimited products"}
            </p>
            <p className="m-0 text-xs text-muted">
              {i === 0 ? "See what's stuck and why." : `Everything in ${plans[i - 1].name}, plus:`}
              {plan.price > 0 && trialDays > 0 ? ` ${trialDays}-day free trial.` : ""}
            </p>
            <ul className="m-0 flex flex-1 list-none flex-col gap-1.5 p-0">
              {plan.features.map((f) => (
                <li key={f} className="flex gap-2 text-[13px]">
                  {CHECK}
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              disabled={isCurrent || pending !== null}
              onClick={() => onChoose(plan.id)}
              className={`cursor-pointer rounded-lg px-3 py-[9px] font-[inherit] font-semibold disabled:cursor-default ${!isCurrent ? "disabled:opacity-50" : ""} ${cta}`}
            >
              {isCurrent
                ? "Your plan"
                : pending === plan.id
                  ? "Opening Shopify…"
                  : plan.price === 0
                    ? confirmFree
                      ? "Yes, cancel my paid plan"
                      : "Downgrade to Free"
                    : `Choose ${plan.name}`}
            </button>
            {plan.price === 0 && confirmFree && !isCurrent && (
              <p className="m-0 text-xs text-muted">Your paid plan ends now and the Free limits apply ({plans[0].products} products).</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** What each plan includes every month (the design's "Limits each month"). */
function Limits({ plans }) {
  const count = (n) => (n == null || n === 0 ? "—" : Number.isFinite(n) ? n.toLocaleString("en-US") : "Unlimited");
  const rows = [
    // The API sends no limit (null) for unlimited products.
    ["Products analyzed", (p) => (p.products == null ? "Unlimited" : count(p.products))],
    ["Diagnoses", (p) => count(p.diagnoses)],
    ["AI descriptions", (p) => count(p.aiTexts)],
    ["AI photos", (p) => count(p.aiPhotos)],
  ];
  return (
    <section aria-labelledby="limits" className={`${CARD} overflow-hidden`}>
      <h2 id="limits" className={`${H2} px-5 pt-4 pb-2.5`}>
        Limits each month
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] border-collapse text-[13px]">
          <thead>
            <tr className={`${THEAD} text-left`}>
              <th scope="col" className="py-2 pr-3 pl-5 font-semibold" />
              {plans.map((p) => (
                <th key={p.id} scope="col" className="px-3 py-2 font-semibold last:pr-5">
                  {p.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label} className={TROW}>
                <th scope="row" className="py-[9px] pr-3 pl-5 text-left font-semibold">
                  {label}
                </th>
                {plans.map((p) => (
                  <td key={p.id} className="px-3 py-[9px] tabular-nums last:pr-5">
                    {value(p)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
