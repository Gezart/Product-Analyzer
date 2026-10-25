"use client";

import { useEffect, useState } from "react";
import { apiError } from "@/app/api-error";
import { CARD_SURFACE } from "@/app/status-style";

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

  if (!current && error) return <s-banner tone="critical">Could not load plans: {error}</s-banner>;
  if (!current) return <s-spinner accessibilityLabel="Loading plans" />;

  return (
    <s-stack gap="base">
      {error && <s-banner tone="critical">{error}</s-banner>}
      {syncError && <s-banner tone="warning">{syncError} Showing the plan last saved; changing plans needs Shopify.</s-banner>}
      <PlanCards plans={plans} current={current} trialDays={trialDays} pending={pending} confirmFree={confirmFree} onChoose={choose} />
    </s-stack>
  );
}

/** Plan cards; the plan right above the current one is marked as the recommended next step. */
export function PlanCards({ plans, current, trialDays, pending, confirmFree = false, onChoose }) {
  const currentIndex = plans.findIndex((p) => p.id === current);
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {plans.map((plan, i) => {
        const isCurrent = plan.id === current;
        const isNext = currentIndex >= 0 && i === currentIndex + 1;
        // Border color is chosen here, not in CARD, so the recommended card's indigo border isn't overridden.
        const edge = isCurrent ? "border-zinc-200 ring-2 ring-emerald-500/40" : isNext ? "border-indigo-300 ring-2 ring-indigo-500/30" : "border-zinc-200";
        return (
          <section key={plan.id} className={`${CARD_SURFACE} ${edge} flex flex-col gap-4 p-5`}>
            <div className="flex min-h-6 items-center justify-between gap-2">
              <h2 className="m-0 text-base font-semibold text-zinc-900">{plan.name}</h2>
              {isCurrent ? (
                <s-badge tone="success">Current plan</s-badge>
              ) : isNext ? (
                <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-semibold text-white">Recommended</span>
              ) : null}
            </div>
            <div>
              <p className="m-0 text-4xl font-bold tracking-tight text-zinc-900 tabular-nums">
                {plan.price === 0 ? (
                  "Free"
                ) : (
                  <>
                    ${plan.price}
                    <span className="ml-1 text-sm font-medium tracking-normal text-zinc-500">/month</span>
                  </>
                )}
              </p>
              <p className="m-0 mt-1 min-h-5 text-sm text-zinc-500">{plan.price > 0 && trialDays > 0 ? `${trialDays}-day free trial` : ""}</p>
            </div>
            <Limit value={plan.products ? plan.products.toLocaleString() : "Unlimited"} label="products analyzed" />
            <ul className="m-0 flex-1 list-none space-y-2 p-0 text-sm text-zinc-700">
              {i > 0 && <li className="text-xs text-zinc-500">Everything in {plans[i - 1].name}, plus:</li>}
              {plan.features.map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <span aria-hidden="true" className="grid h-4.5 w-4.5 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-600">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  </span>
                  {f}
                </li>
              ))}
            </ul>
            {!isCurrent && (
              <div>
                <s-button
                  variant={plan.price > 0 ? "primary" : "secondary"}
                  tone={plan.price === 0 && confirmFree ? "critical" : undefined}
                  loading={pending === plan.id || undefined}
                  disabled={pending !== null || undefined}
                  onClick={() => onChoose(plan.id)}
                >
                  {plan.price === 0 ? (confirmFree ? "Yes, cancel my paid plan" : "Downgrade to Free") : `Choose ${plan.name}`}
                </s-button>
                {plan.price === 0 && confirmFree && (
                  <p className="m-0 mt-2 text-sm text-zinc-500">Your paid plan ends now and the Free limits apply (25 products).</p>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Limit({ value, label }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
      <div className="text-base font-semibold text-zinc-900 tabular-nums">{value}</div>
      <div className="text-xs text-zinc-500">{label}</div>
    </div>
  );
}
