"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const STEPS = [
  { resource: "products", label: "Products and stock" },
  { resource: "orders", label: "Last 60 days of orders" },
];

const statusOf = (sync, resource) => sync.states.find((x) => x.resource === resource)?.status ?? "pending";

/** Shows the initial import step by step; polls until done or a step fails, then offers a retry. */
export function SyncProgress() {
  const [sync, setSync] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const timer = useRef(undefined);

  const load = useCallback(async () => {
    clearTimeout(timer.current);
    const res = await fetch("/api/sync").catch(() => null);
    if (res?.ok) {
      const data = await res.json();
      setSync(data);
      const statuses = STEPS.map((s) => statusOf(data, s.resource));
      if (statuses.every((s) => s === "done") || statuses.includes("error")) return;
    }
    timer.current = setTimeout(load, 3000);
  }, []);

  useEffect(() => {
    load();
    return () => clearTimeout(timer.current);
  }, [load]);

  const retryRef = useCallback(
    (el) => {
      if (!el) return;
      const onClick = async () => {
        setRetrying(true);
        await fetch("/api/sync", { method: "POST" }).catch(() => null);
        setRetrying(false);
        load();
      };
      el.addEventListener("click", onClick);
      return () => el.removeEventListener("click", onClick);
    },
    [load],
  );

  if (!sync) return null;
  const statuses = STEPS.map((s) => statusOf(sync, s.resource));
  if (statuses.every((s) => s === "done")) return null;
  const doneCount = statuses.filter((s) => s === "done").length;
  const failed = statuses.includes("error");

  return (
    <s-section heading={failed ? "The store import stopped" : "Analyzing your store"}>
      <s-stack gap="small">
        <div className="h-2 w-full overflow-hidden rounded bg-zinc-200">
          <div className="h-full bg-emerald-600 transition-all" style={{ width: `${(doneCount / STEPS.length) * 100}%` }} />
        </div>
        {STEPS.map((step, i) => {
          const state = sync.states.find((x) => x.resource === step.resource);
          return (
            <s-text key={step.resource} tone={statuses[i] === "error" ? "critical" : undefined}>
              {statuses[i] === "done" ? "✓" : statuses[i] === "error" ? "✕" : "…"} {step.label}
              {step.resource === "products" && sync.products > 0 ? ` (${sync.products.toLocaleString()})` : ""}
              {state?.error ? ` — ${state.error}` : ""}
            </s-text>
          );
        })}
        {failed && (
          <div>
            <s-button loading={retrying || undefined} ref={retryRef}>
              Try again
            </s-button>
          </div>
        )}
      </s-stack>
    </s-section>
  );
}
