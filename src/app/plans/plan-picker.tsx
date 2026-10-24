"use client";

import { useEffect, useState } from "react";

type Plan = {
  id: string;
  name: string;
  price: number;
  products: number | null;
  diagnoses: number;
  features: string[];
};

export function PlanPicker() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [trialDays, setTrialDays] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/billing");
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const data = await res.json();
    setPlans(data.plans);
    setCurrent(data.current);
    setTrialDays(data.trialDays);
  }

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, []);

  async function choose(planId: string) {
    setPending(planId);
    setError(null);
    try {
      const res = await fetch("/api/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planId }),
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      const { confirmationUrl } = await res.json();
      // Shopify's approval page must open in the top window, outside the iframe.
      if (confirmationUrl) window.open(confirmationUrl, "_top");
      else await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(null);
    }
  }

  if (error) return <s-banner tone="critical">Could not load plans: {error}</s-banner>;
  if (!current) return <s-spinner accessibilityLabel="Loading plans" />;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {plans.map((plan) => {
        const isCurrent = plan.id === current;
        return (
          <s-section key={plan.id} heading={plan.name}>
            <s-stack gap="base">
              <s-heading>{plan.price === 0 ? "Free" : `$${plan.price}/month`}</s-heading>
              {plan.price > 0 && trialDays > 0 && <s-text tone="neutral">{trialDays}-day free trial</s-text>}
              <s-unordered-list>
                <s-list-item>{plan.products ? `${plan.products.toLocaleString()} products` : "Unlimited products"}</s-list-item>
                <s-list-item>{plan.diagnoses} diagnoses / month</s-list-item>
                {plan.features.map((f) => (
                  <s-list-item key={f}>{f}</s-list-item>
                ))}
              </s-unordered-list>
              {isCurrent ? (
                <s-badge tone="success">Current plan</s-badge>
              ) : (
                <s-button
                  variant={plan.price > 0 ? "primary" : "secondary"}
                  loading={pending === plan.id || undefined}
                  disabled={pending !== null || undefined}
                  onClick={() => choose(plan.id)}
                >
                  {plan.price === 0 ? "Downgrade to Free" : `Choose ${plan.name}`}
                </s-button>
              )}
            </s-stack>
          </s-section>
        );
      })}
    </div>
  );
}
