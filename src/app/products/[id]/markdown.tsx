"use client";

import { useCallback, useEffect, useState } from "react";
import { listen } from "@/app/polaris-events";

type VariantPlan = { id: string; title: string; originalPrice: number; floor: number; stepPrices: number[]; compareAt: number };
type Proposal = { variants: VariantPlan[]; skipped: { id: string; title: string; reason: string }[] };
type Plan = {
  id: string;
  status: string;
  currentStep: number;
  startStock: number;
  endAction: string;
  endReason: string | null;
  startedAt: string;
  endedAt: string | null;
  steps: { variants: VariantPlan[] };
};
type PriceChange = { id: string; variantGid: string | null; oldPrice: string; newPrice: string; reason: string; status: string; changedAt: string };
type Data = {
  plan: Plan | null;
  eligible: string | null;
  preview: { proposal: Proposal; settings: { marginFloorPct: number; maxDiscountPct: number; endAction: string }; stock: number } | null;
  ladder: { steps: number[]; stepDays: number; sellThroughStop: number };
  priceChanges: PriceChange[];
  today: string;
};

const DAY = 86_400_000;
const addDays = (date: string, n: number) => new Date(Date.parse(date) + n * DAY).toISOString().slice(0, 10);

/** Markdown ladder: preview → approve; then the running plan, its next step, cancel; and the price log. */
export function Markdown({ productId, money, onChanged }: { productId: string; money: Intl.NumberFormat; onChanged: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "critical"; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/products/${productId}/markdown`);
    if (res.ok) setData(await res.json());
  }, [productId]);
  useEffect(() => {
    load();
  }, [load]);

  async function act(url: string, body: unknown, ok: (out: { status?: string; endReason?: string | null }) => string) {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg(res.ok ? { tone: "success", text: ok(out) } : { tone: "critical", text: out.error ?? `Failed (${res.status})` });
    await load();
    if (res.ok) onChanged();
  }

  if (!data) return null;
  const running = data.plan && ["active", "paused"].includes(data.plan.status) ? data.plan : null;
  if (!running && !data.preview && data.priceChanges.length === 0) return null;
  const p = (n: number) => money.format(n);

  return (
    <s-section heading="Markdown">
      <s-stack gap="base">
        {msg && <s-banner tone={msg.tone}>{msg.text}</s-banner>}

        {running && (
          <s-stack gap="small">
            <s-badge tone={running.status === "paused" ? "warning" : "info"}>{running.status === "paused" ? "Paused" : "Running"}</s-badge>
            {running.status === "paused" && <s-text>{running.endReason}. The app won&apos;t change this product&apos;s prices until you cancel.</s-text>}
            <s-text>
              Step {running.currentStep + 1} of {data.ladder.steps.length} since {running.startedAt.slice(0, 10)}.{" "}
              {running.currentStep + 1 < data.ladder.steps.length &&
                `Next step on ${addDays(running.startedAt, (running.currentStep + 1) * data.ladder.stepDays)}. `}
              Stops when {Math.ceil(running.startStock * data.ladder.sellThroughStop)} of the {running.startStock} units in stock at the start have
              sold, then {running.endAction === "hold" ? "keeps the last price" : "restores the original price"}.
            </s-text>
            <LadderTable variants={running.steps.variants} current={running.currentStep} startedAt={running.startedAt} ladder={data.ladder} p={p} />
            <div>
              <s-button loading={busy || undefined} disabled={busy || undefined} ref={listen("click", () => act(`/api/markdown/${running.id}/cancel`, {}, () => "Markdown cancelled; original prices restored."))}>
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
                      act(`/api/products/${productId}/markdown`, { expected: data.preview!.proposal }, (plan) =>
                        plan.status === "active" ? "Approved. Step 1 is live in your store." : `Approved, but paused: ${plan.endReason ?? "see below"}.`,
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
                  <span>
                    {p(Number(c.oldPrice))} → {p(Number(c.newPrice))}
                  </span>
                  <span className="text-zinc-500">{c.reason.replace("_", " ")}</span>
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
  current,
  startedAt,
  ladder,
  p,
}: {
  variants: VariantPlan[];
  current: number;
  startedAt: string;
  ladder: Data["ladder"];
  p: (n: number) => string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-zinc-500">
          <tr>
            <th className="py-2 pr-4 font-medium">Variant</th>
            <th className="py-2 pr-4 text-right font-medium">Now</th>
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
              {v.stepPrices.map((s, i) => (
                <td key={i} className={`py-2 pr-4 text-right ${i === current ? "font-semibold" : ""}`}>
                  {p(s)}
                  {s === v.floor ? " (floor)" : ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
