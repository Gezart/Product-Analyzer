"use client";

import { useEffect, useState } from "react";

type State = { resource: string; status: string; error: string | null };
type Sync = { states: State[]; products: number };

const STEPS = [
  { resource: "products", label: "Products and stock" },
  { resource: "orders", label: "Last 60 days of orders" },
];

/** Shows the initial import step by step; polls until every step is done or failed. */
export function SyncProgress() {
  const [sync, setSync] = useState<Sync | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      const res = await fetch("/api/sync").catch(() => null);
      if (!res?.ok) return;
      const data: Sync = await res.json();
      setSync(data);
      const finished = STEPS.every((s) => ["done", "error"].includes(data.states.find((x) => x.resource === s.resource)?.status ?? ""));
      if (!finished) timer = setTimeout(load, 3000);
    };
    load();
    return () => clearTimeout(timer);
  }, []);

  if (!sync) return null;
  const doneCount = STEPS.filter((s) => sync.states.find((x) => x.resource === s.resource)?.status === "done").length;
  if (doneCount === STEPS.length) return null;

  return (
    <s-section heading="Analyzing your store">
      <s-stack gap="small">
        <div className="h-2 w-full overflow-hidden rounded bg-zinc-200">
          <div className="h-full bg-emerald-600 transition-all" style={{ width: `${(doneCount / STEPS.length) * 100}%` }} />
        </div>
        {STEPS.map((step) => {
          const state = sync.states.find((x) => x.resource === step.resource);
          const status = state?.status ?? "pending";
          return (
            <s-text key={step.resource} tone={status === "error" ? "critical" : undefined}>
              {status === "done" ? "✓" : status === "error" ? "✕" : "…"} {step.label}
              {step.resource === "products" && sync.products > 0 ? ` (${sync.products.toLocaleString()})` : ""}
              {state?.error ? ` — ${state.error}` : ""}
            </s-text>
          );
        })}
      </s-stack>
    </s-section>
  );
}
