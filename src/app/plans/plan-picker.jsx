"use client";

import { useEffect, useState } from "react";
import { apiError } from "@/app/api-error";

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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan, i) => {
          const isCurrent = plan.id === current;
          return (
            <s-section key={plan.id} heading={plan.name}>
              <s-stack gap="base">
                <s-heading>{plan.price === 0 ? "Free" : `$${plan.price}/month`}</s-heading>
                {plan.price > 0 && trialDays > 0 && <s-text tone="neutral">{trialDays}-day free trial</s-text>}
                {i > 0 && <s-text tone="neutral">Everything in {plans[i - 1].name}, plus:</s-text>}
                <s-unordered-list>
                  <s-list-item>{plan.products ? `${plan.products.toLocaleString()} products analyzed` : "Unlimited products"}</s-list-item>
                  {plan.features.map((f) => (
                    <s-list-item key={f}>{f}</s-list-item>
                  ))}
                </s-unordered-list>
                {isCurrent ? (
                  <s-badge tone="success">Current plan</s-badge>
                ) : (
                  <s-button
                    variant={plan.price > 0 ? "primary" : "secondary"}
                    tone={plan.price === 0 && confirmFree ? "critical" : undefined}
                    loading={pending === plan.id || undefined}
                    disabled={pending !== null || undefined}
                    onClick={() => choose(plan.id)}
                  >
                    {plan.price === 0 ? (confirmFree ? "Yes, cancel my paid plan" : "Downgrade to Free") : `Choose ${plan.name}`}
                  </s-button>
                )}
                {plan.price === 0 && confirmFree && !isCurrent && (
                  <s-text tone="neutral">Your paid plan ends now and the Free limits apply (25 products).</s-text>
                )}
              </s-stack>
            </s-section>
          );
        })}
      </div>
    </s-stack>
  );
}
