"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { BTN, CARD, H2 } from "@/app/ui/kit";
import { hasFeature } from "@/lib/plans";

const STEPS = [
  { resource: "products", label: "Products and stock" },
  { resource: "orders", label: "Last 60 days of orders" },
];

/** Shopify's import errors in plain words (the original code stays at the end for support). */
function friendlyError(error) {
  if (/ACCESS_DENIED/.test(error)) return `Shopify refused access. Open the app again and approve the permissions it asks for. (${error})`;
  if (/fetch failed|no response/i.test(error)) return `Couldn't reach Shopify. Try again in a moment. (${error})`;
  return error;
}

const statusOf = (sync, resource) => sync.states.find((x) => x.resource === resource)?.status ?? "pending";

/**
 * The first import (the owner's design): shown on its own, step by step, until it's done (then
 * `children`, the dashboard); polls until done or a step fails, then offers a retry.
 */
export function SyncProgress({ children }) {
  const [sync, setSync] = useState(null);
  // The import's state couldn't be read: the dashboard shows meanwhile (it has its own notices).
  const [unknown, setUnknown] = useState(false);
  const [plan, setPlan] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const timer = useRef(undefined);

  const load = useCallback(async () => {
    clearTimeout(timer.current);
    const res = await fetch("/api/sync").catch(() => null);
    if (res?.ok) {
      const data = await res.json();
      setSync(data);
      setUnknown(false);
      const statuses = STEPS.map((s) => statusOf(data, s.resource));
      if (statuses.every((s) => s === "done") || statuses.includes("error")) return;
    } else setUnknown(true);
    timer.current = setTimeout(load, 3000);
  }, []);

  useEffect(() => {
    load();
    // Which settings help while waiting depends on the plan.
    fetch("/api/shop")
      .then((res) => (res.ok ? res.json() : null))
      .then((shop) => shop && setPlan(shop.plan))
      .catch(() => {});
    return () => clearTimeout(timer.current);
  }, [load]);

  async function retry() {
    setRetrying(true);
    await fetch("/api/sync", { method: "POST" }).catch(() => null);
    setRetrying(false);
    load();
  }

  if (!sync) return unknown ? children : null;
  const statuses = STEPS.map((s) => statusOf(sync, s.resource));
  if (statuses.every((s) => s === "done")) return children;
  const doneCount = statuses.filter((s) => s === "done").length;
  const failed = statuses.includes("error");
  const running = statuses.findIndex((s) => s !== "done");
  const steps = [
    ...STEPS.map((step, i) => {
      const state = sync.states.find((x) => x.resource === step.resource);
      const status = statuses[i];
      return {
        title: step.label,
        detail: state?.error
          ? friendlyError(state.error)
          : step.resource === "products" && sync.products > 0
            ? `${sync.products.toLocaleString("en-US")} products`
            : step.resource === "orders"
              ? "Refunds and cancellations included"
              : "",
        status: status === "done" ? "done" : status === "error" ? "error" : i === running ? "running" : "next",
      };
    }),
    { title: "First analysis", detail: "Statuses, money at stake and your top 10", status: "next" },
  ];
  const MARKS = {
    done: ["✓", "bg-[#D1FAE5] text-[#047857]", "Done"],
    running: [null, "bg-accent-soft text-accent", "Importing…"],
    next: [null, "bg-canvas text-muted", "Next"],
    error: ["✕", "bg-[#FEE2E2] text-[#B91C1C]", "Stopped"],
  };

  return (
    <>
      <header className="flex items-center gap-2.5">
        <span aria-hidden="true" className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-ink font-bold text-white">
          U
        </span>
        <div>
          <h1 className="m-0 text-[22px] font-bold tracking-[-0.01em]">{failed ? "The store import stopped" : "Analyzing your store"}</h1>
          <p className="m-0 text-[13px] text-muted">{failed ? "Try again below; nothing was lost." : "You can close this page; the dashboard appears by itself."}</p>
        </div>
      </header>
      <section aria-labelledby="import" className={`${CARD} flex flex-col gap-3.5 px-[22px] py-5`}>
        <h2 id="import" className={H2}>
          Import
        </h2>
        <div
          role="progressbar"
          aria-label="Import progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round((doneCount / (STEPS.length + 1)) * 100)}
          className="h-2 overflow-hidden rounded-full bg-hair"
        >
          <div className={`h-full transition-all ${failed ? "bg-[#DC2626]" : "bg-accent"}`} style={{ width: `${Math.max(4, (doneCount / (STEPS.length + 1)) * 100)}%` }} />
        </div>
        <ol className="m-0 flex list-none flex-col p-0">
          {steps.map((step, i) => {
            const [mark, tone, label] = MARKS[step.status];
            return (
              <li key={step.title} className="flex items-center gap-3 border-t border-hair py-2.5">
                <span aria-hidden="true" className={`grid h-6 w-6 flex-none place-items-center rounded-full text-xs font-bold ${tone}`}>
                  {mark ?? i + 1}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-semibold">{step.title}</span>
                  {step.detail && <span className={`text-[13px] ${step.status === "error" ? "text-[#B91C1C]" : "text-muted"}`}>{step.detail}</span>}
                </span>
                <span className={`text-[13px] font-semibold ${tone.split(" ").find((c) => c.startsWith("text-"))}`}>{label}</span>
              </li>
            );
          })}
        </ol>
        {failed && (
          <button type="button" disabled={retrying} onClick={retry} className={`${BTN.primary} cursor-pointer self-start`}>
            {retrying ? "Starting again…" : "Try again"}
          </button>
        )}
      </section>
      {!failed && (
        <section aria-labelledby="meanwhile" className={`${CARD} flex flex-col gap-3 px-[22px] py-5`}>
          <h2 id="meanwhile" className={H2}>
            While you wait (optional)
          </h2>
          <ul className="m-0 grid list-none gap-2.5 p-0 sm:grid-cols-3">
            {(hasFeature(plan, "marketPrice")
              ? [
                  { title: "Connect Google Merchant Center", body: "See the market price for your products and how far above it you are.", cta: "Connect", href: "/settings#google" },
                  { title: "Seasonal products", body: "Mark winter or summer collections so they aren't called dead stock off season.", cta: "Set seasons", href: "/settings#season" },
                  { title: "Your minimum margin", body: "Markdowns never go below cost + this margin.", cta: "Set margin", href: "/settings#prices" },
                ]
              : [
                  { title: "Seasonal products", body: "Mark winter or summer collections so they aren't called dead stock off season.", cta: "Set seasons", href: "/settings#season" },
                  { title: "What isn't for sale", body: "Leave out gift cards or archived collections, so they aren't analyzed.", cta: "Choose what to leave out", href: "/settings#excluded" },
                  { title: "Fix what's stuck", body: "The Fix center, rescue plans and markdowns come with the Starter plan.", cta: "See plans", href: "/plans" },
                ]
            ).map((s) => (
              <li key={s.title} className="flex flex-col gap-1.5 rounded-[10px] border border-line px-3.5 py-3">
                <span className="font-semibold">{s.title}</span>
                <span className="flex-1 text-[13px] text-muted">{s.body}</span>
                <Link href={s.href} className="text-[13px] font-semibold">
                  {s.cta}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
