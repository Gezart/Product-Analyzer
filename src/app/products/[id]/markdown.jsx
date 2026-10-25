"use client";

import { useCallback, useEffect, useState } from "react";
import { apiError } from "@/app/api-error";
import { listen } from "@/app/polaris-events";
import { UpgradeBanner } from "@/app/upgrade-banner";
import { shiftDate } from "@/lib/dates";
import { getPlan } from "@/lib/plans";

const addDays = (date, n) => shiftDate(date.slice(0, 10), n);
const REASONS = { markdown: "Markdown step", restore: "Original price restored", guard_revert: "Raised to the price floor" };

/** Markdown ladder: preview → approve; then the running plan, its next step, cancel; and the price log. */
export function Markdown({ productId, money, onChanged }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/products/${productId}/markdown`);
    if (res.ok) {
      setData(await res.json());
      setLoadError(null);
    } else setLoadError((await apiError(res)).message);
  }, [productId]);
  useEffect(() => {
    load();
  }, [load]);

  async function act(url, body, ok) {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg(res.ok ? ok(out) : { tone: "critical", text: out.error ?? `Failed (${res.status})` });
    await load();
    if (res.ok) onChanged();
  }

  if (loadError && !data) {
    return (
      <s-section heading="Markdown">
        <s-banner tone="warning">Couldn&apos;t load the markdown: {loadError}</s-banner>
      </s-section>
    );
  }
  if (!data) return null;
  const running = data.plan && ["active", "paused"].includes(data.plan.status) ? data.plan : null;
  const locked = !running && data.upgrade && data.eligible;
  const unavailable = !running && !locked && data.eligible && data.previewError;
  if (!running && !data.preview && !locked && !unavailable && data.priceChanges.length === 0) return null;
  const variantTitle = new Map((data.plan?.steps?.variants ?? []).map((v) => [v.id, v.title]));
  const p = (n) => money.format(n);

  return (
    <s-section heading="Markdown">
      <s-stack gap="base">
        {msg && <s-banner tone={msg.tone}>{msg.text}</s-banner>}
        {locked && (
          <UpgradeBanner>
            {data.eligible} A stepped markdown is the next step; for this product it needs the {getPlan(data.upgrade)?.name ?? "next"} plan.
          </UpgradeBanner>
        )}

        {unavailable && (
          <s-banner tone="warning">
            {data.eligible} A markdown can be proposed, but the live prices couldn&apos;t be read: {data.previewError}
          </s-banner>
        )}

        {running && (
          <s-stack gap="small">
            <s-badge tone={running.status === "paused" ? "warning" : "info"}>{running.status === "paused" ? "Paused" : "Running"}</s-badge>
            {running.status === "paused" && <s-text>{running.endReason}. No further steps; when the plan ends (stock sold or ladder done) the app still restores or holds prices as set. Cancel to restore now.</s-text>}
            <s-text>
              {running.currentStep < 0
                ? "Step 1 isn't live yet; the app retries within the hour. "
                : `Step ${running.currentStep + 1} of ${data.ladder.steps.length}, live since ${addDays(running.startedAt, running.currentStep * data.ladder.stepDays)}. `}
              {running.currentStep >= 0 &&
                running.currentStep + 1 < data.ladder.steps.length &&
                `Next step on ${addDays(running.startedAt, (running.currentStep + 1) * data.ladder.stepDays)}. `}
              Stops when {Math.ceil(running.startStock * data.ladder.sellThroughStop)} of the {running.startStock} units in stock at the start have
              sold, then {running.endAction === "hold" ? "keeps the last price" : "restores the original price"}.
            </s-text>
            <LadderTable
              variants={running.steps.variants}
              applied={running.steps.applied}
              current={running.currentStep}
              startedAt={running.startedAt}
              ladder={data.ladder}
              p={p}
            />
            <s-text tone="neutral">Later steps are recalculated against the live cost and your settings when they go live.</s-text>
            <div>
              <s-button loading={busy || undefined} disabled={busy || undefined} ref={listen("click", () => act(`/api/markdown/${running.id}/cancel`, {}, () => ({ tone: "success", text: "Markdown cancelled; original prices restored." })))}>
                Cancel and restore prices
              </s-button>
            </div>
          </s-stack>
        )}

        {!running && data.preview && (
          <s-stack gap="small">
            <s-text>{data.eligible} Proposed: a stepped discount shown with a compare-at price, one step every {data.ladder.stepDays} days.</s-text>
            <s-text tone="neutral">
              Never below cost + {data.preview.settings.marginFloorPct}% margin, never more than {data.preview.settings.maxDiscountPct}% off. At the end:{" "}
              {data.preview.settings.endAction === "hold" ? "keep the last price" : "restore the original price"} (change in Settings).
            </s-text>
            {data.preview.proposal.variants.length > 0 ? (
              <>
                <LadderTable variants={data.preview.proposal.variants} current={-1} startedAt={data.today} ladder={data.ladder} p={p} />
                <div>
                  <s-button
                    variant="primary"
                    loading={busy || undefined}
                    disabled={busy || undefined}
                    ref={listen("click", () =>
                      act(`/api/products/${productId}/markdown`, { expected: data.preview.proposal }, (plan) =>
                        plan.status !== "active"
                          ? { tone: "warning", text: plan.status === "paused" ? `Started but paused: ${plan.endReason}.` : `Not started: ${plan.endReason ?? plan.status}.` }
                          : plan.notice
                            ? { tone: "warning", text: `Approved. ${plan.notice}` }
                            : { tone: "success", text: "Approved. Step 1 is live in your store." },
                      ),
                    )}
                  >
                    Approve schedule
                  </s-button>
                </div>
              </>
            ) : (
              <s-banner tone="warning">No variant can be discounted within your margin floor.</s-banner>
            )}
            {data.preview.proposal.skipped.length > 0 && (
              <ul className="m-0 list-disc pl-5 text-sm text-zinc-600">
                {data.preview.proposal.skipped.map((s) => (
                  <li key={s.id}>
                    {s.title}: {s.reason}
                  </li>
                ))}
              </ul>
            )}
          </s-stack>
        )}

        {data.priceChanges.length > 0 && (
          <s-stack gap="small">
            <s-text>Price log</s-text>
            <ul className="m-0 list-none space-y-1 p-0 text-sm">
              {data.priceChanges.map((c) => (
                <li key={c.id} className="flex flex-wrap gap-2">
                  <span className="text-zinc-500">{new Date(c.changedAt).toLocaleString()}</span>
                  {variantTitle.get(c.variantGid) && <span className="font-medium">{variantTitle.get(c.variantGid)}</span>}
                  <span>
                    {p(Number(c.oldPrice))} → {p(Number(c.newPrice))}
                  </span>
                  <span className="text-zinc-500">{REASONS[c.reason] ?? c.reason}</span>
                  {c.status !== "applied" && <s-badge tone={c.status === "failed" ? "critical" : undefined}>{c.status}</s-badge>}
                </li>
              ))}
            </ul>
          </s-stack>
        )}
      </s-stack>
    </s-section>
  );
}

function LadderTable({
  variants,
  applied,
  current,
  startedAt,
  ladder,
  p,
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-sm">
        <thead className="text-zinc-500">
          <tr>
            <th className="py-2 pr-4 font-medium">Variant</th>
            <th className="py-2 pr-4 text-right font-medium">Regular price</th>
            <th className="py-2 pr-4 text-right font-medium">Lowest allowed</th>
            {ladder.steps.map((d, i) => (
              <th key={i} className={`py-2 pr-4 text-right font-medium ${i === current ? "text-zinc-900" : ""}`}>
                {Math.round(d * 100)}% · {addDays(startedAt.slice(0, 10), i * ladder.stepDays)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {variants.map((v) => (
            <tr key={v.id} className="border-t border-zinc-200">
              <td className="py-2 pr-4">{v.title}</td>
              <td className="py-2 pr-4 text-right">{p(v.originalPrice)}</td>
              <td className="py-2 pr-4 text-right">{p(v.floor)}</td>
              {v.stepPrices.map((planned, i) => {
                // The current step shows what the app actually wrote (it can differ after a cost or settings change).
                const s = i === current && applied?.[v.id] ? applied[v.id].price : planned;
                return (
                  <td key={i} className={`py-2 pr-4 text-right ${i === current ? "font-semibold" : ""}`}>
                    {p(s)}
                    {s === v.floor ? " (floor)" : ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
