"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiError } from "@/app/api-error";
import { BTN, CARD, H2, Notice, PageHeader, Pill, THEAD, TROW, UpgradeNotice } from "@/app/ui/kit";
import { shiftDate } from "@/lib/dates";
import { currentFloor } from "@/lib/markdown";
import { getPlan } from "@/lib/plans";
import { moneyFormatter, STATUS_INFO } from "@/lib/status-info";

const addDays = (date, n) => shiftDate(String(date).slice(0, 10), n);
const shortDay = (key) => new Date(`${key}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const stamp = (iso) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const REASONS = { markdown: "Markdown step", restore: "Original price restored", guard_revert: "Raised to the price floor" };
const LOG_STATUS = { applied: ["good", "Applied"], failed: ["bad", "Failed"], pending: ["neutral", "Pending"] };
const ENDED = { completed: "Ended", cancelled: "Cancelled", failed: "Failed" };
const END_REASONS = { stock_cleared: "half the starting stock sold", ladder_finished: "all steps done", cancelled: "cancelled" };
/** The chart's height for the starting price, in pixels. */
const CHART = 200;

/**
 * The markdown engine for one product (the owner's design): the ladder with its floor, what it did, the
 * rules and guarantees, and the price log. Before a plan: the proposed ladder to approve.
 */
export function Markdown({ productId }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/products/${productId}/markdown`).catch(() => null);
    if (res?.ok) {
      setData(await res.json());
      setLoadError(null);
    } else setLoadError(res ? (await apiError(res)).message : "Could not reach the app.");
  }, [productId]);
  useEffect(() => {
    load();
  }, [load]);

  async function act(url, body, ok) {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const out = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    setMsg(res?.ok ? ok(out) : { tone: "bad", text: out.error ?? `Failed (${res?.status ?? "network"})` });
    await load();
  }

  const back = { href: `/products/${productId}`, label: data?.title ?? "Product" };
  const title = data?.title ? `Markdown · ${data.title}` : "Markdown";
  if (loadError && !data) return <><PageHeader back={back} title={title} /><Notice tone="bad">Couldn&apos;t load the markdown: {loadError}</Notice></>;
  if (!data) return <><PageHeader back={back} title={title} /><p className="m-0 text-muted">Loading the markdown…</p></>;

  const money = moneyFormatter(data.currency, 2);
  const money0 = moneyFormatter(data.currency);
  const plan = data.plan;
  const running = plan && ["active", "paused"].includes(plan.status) ? plan : null;
  const locked = !running && data.upgrade && data.eligible;
  const unavailable = !running && !locked && data.eligible && data.previewError;
  const proposal = !running && data.preview ? data.preview.proposal : null;
  const variants = running ? running.steps.variants : (proposal?.variants ?? []);
  const variantTitle = new Map((plan?.steps?.variants ?? []).map((v) => [v.id, v.title]));
  const current = running ? running.currentStep : -1;
  const steps = data.ladder.steps;
  const startedOn = running ? String(running.startedAt).slice(0, 10) : data.today;
  const status = data.scoreStatus && STATUS_INFO[data.scoreStatus];
  // A running plan's floor is the stricter of the floor at approval and today's cost + margin (as the engine checks).
  const floorOf = (v) => (running && data.rules ? currentFloor(v, data.costs?.[v.id] ?? null, data.rules.marginFloorPct) : v.floor);
  // What the plan did: while it runs, or the last one when nothing new is proposed (a failed start that changed nothing has none).
  const showResults = data.results && plan && (running || (!proposal && !(plan.status === "failed" && plan.currentStep < 0)));

  const pill = running
    ? running.status === "paused"
      ? <Pill tone="warn">Paused</Pill>
      : <Pill tone="good">{current < 0 ? "Starting" : `Running · step ${current + 1} of ${steps.length}`}</Pill>
    : plan && ENDED[plan.status]
      ? <Pill tone="neutral">{ENDED[plan.status]}</Pill>
      : proposal?.variants.length
        ? <Pill tone="info">Ready to start</Pill>
        : null;
  const cancel = running && (
    <button
      type="button"
      disabled={busy}
      onClick={() => act(`/api/markdown/${running.id}/cancel`, {}, () => ({ tone: "good", text: "Markdown cancelled; original prices restored." }))}
      className={`${BTN.secondary} cursor-pointer text-[#B91C1C] hover:text-[#B91C1C]`}
    >
      {busy ? "Working…" : "Cancel and restore prices"}
    </button>
  );

  return (
    <>
      <Link href={back.href} className="self-start text-[13px] font-semibold">
        ← {back.label}
      </Link>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="m-0 text-[22px] font-bold tracking-[-0.01em]">{title}</h1>
          {(pill || status) && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {pill}
              {status && <Pill tone={data.scoreStatus}>{status.label}</Pill>}
            </div>
          )}
        </div>
        {cancel && <div className="flex flex-wrap gap-2">{cancel}</div>}
      </header>

      {msg && <Notice tone={msg.tone} compact>{msg.text}</Notice>}
      {running?.status === "active" && current < 0 && <Notice compact>Step 1 isn&apos;t live yet; the app retries within the hour.</Notice>}
      {running?.status === "paused" && (
        <Notice tone="warn" compact>
          {running.endReason}. No further steps; when the plan ends (stock sold or ladder done) the app still restores or holds prices as set. Cancel to restore them now.
        </Notice>
      )}
      {plan && !running && ENDED[plan.status] && plan.endReason && <Notice compact>The last markdown ended: {END_REASONS[plan.endReason] ?? plan.endReason}.</Notice>}
      {locked && (
        <UpgradeNotice>
          {data.eligible} A stepped markdown is the next step; for this product it needs the {getPlan(data.upgrade)?.name ?? "next"} plan.
        </UpgradeNotice>
      )}
      {unavailable && (
        <Notice tone="warn" compact>
          {data.eligible} A markdown can be proposed, but the live prices couldn&apos;t be read: {data.previewError}
        </Notice>
      )}
      {!running && !proposal && !locked && !unavailable && (
        <Notice compact>No markdown for this product now. One is proposed for dead stock, when a rescue plan changes nothing, or right after its season ends.</Notice>
      )}

      {variants.length > 0 && (
        <Ladder
          variants={variants}
          applied={running?.steps.applied}
          current={current}
          startedOn={startedOn}
          ladder={data.ladder}
          money={money}
          running={Boolean(running)}
          paused={running?.status === "paused"}
          floorOf={floorOf}
        />
      )}

      {proposal && (
        <section aria-label="Approve the markdown" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent-line bg-accent-soft px-[18px] py-3.5">
          <p className="m-0 flex-[1_1_420px]">
            <strong>{data.eligible}</strong> Proposed: a stepped discount shown with a compare-at price, one step every {data.ladder.stepDays} days.
          </p>
          {proposal.variants.length > 0 ? (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                act(`/api/products/${productId}/markdown`, { expected: proposal }, (p) =>
                  p.status !== "active"
                    ? { tone: "warn", text: p.status === "paused" ? `Started but paused: ${p.endReason}.` : `Not started: ${p.endReason ?? p.status}.` }
                    : p.notice
                      ? { tone: "warn", text: `Approved. ${p.notice}` }
                      : { tone: "good", text: "Approved. Step 1 is live in your store." },
                )
              }
              className={`${BTN.primary} cursor-pointer`}
            >
              {busy ? "Starting…" : "Approve schedule"}
            </button>
          ) : (
            <span className="text-[13px] font-semibold text-[#92400E]">No variant can be discounted within your margin floor.</span>
          )}
        </section>
      )}
      {proposal?.skipped.length > 0 && (
        <Notice tone="warn" compact>
          <ul className="m-0 flex list-disc flex-col gap-0.5 pl-4">
            {proposal.skipped.map((s) => (
              <li key={s.id}>
                {s.title}: {s.reason}
              </li>
            ))}
          </ul>
        </Notice>
      )}

      {showResults && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Tile
            label={running ? "Sold since the start" : "Sold during the last markdown"}
            value={data.results.soldSince.toLocaleString()}
            sub={`${data.results.soldBefore.toLocaleString()} in the 30 days before`}
          />
          <Tile label={running ? "Stock left" : "Stock now"} value={data.results.stockNow.toLocaleString()} sub={plan.startStock ? `was ${plan.startStock.toLocaleString()} at the start` : ""} />
          <Tile label={running ? "Revenue from the plan" : "Revenue during it"} value={money0.format(data.results.revenueSince)} sub="what shoppers paid, after discount codes" />
        </div>
      )}

      {variants.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          <Rules data={data} plan={running} variants={variants} money={money} floorOf={floorOf} />
          <section aria-labelledby="guard" className={`${CARD} flex flex-col gap-2 px-5 py-[18px]`}>
            <h2 id="guard" className={H2}>
              Never below the floor
            </h2>
            <ul className="m-0 flex list-disc flex-col gap-1 pl-[18px] text-[13px] text-ink-2">
              <li>Every price is checked against today&apos;s cost right before it is written.</li>
              <li>The database refuses any markdown price below the floor.</li>
              <li>If you change the price in Shopify, the plan pauses instead of overwriting it.</li>
              <li>Cancel restores only the prices this plan wrote.</li>
            </ul>
          </section>
        </div>
      )}

      {data.priceChanges.length > 0 && (
        <section aria-labelledby="log" className={`${CARD} overflow-hidden`}>
          <h2 id="log" className={`${H2} px-5 pt-4 pb-2.5`}>
            Price log
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-[13px]">
              <thead>
                <tr className={`${THEAD} text-left`}>
                  <th scope="col" className="py-2 pr-3 pl-5 font-semibold">
                    Date
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Variant
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Price
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Status
                  </th>
                  <th scope="col" className="py-2 pr-5 pl-3 font-semibold">
                    Reason
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.priceChanges.map((c) => {
                  const [tone, label] = LOG_STATUS[c.status] ?? ["neutral", c.status];
                  return (
                    <tr key={c.id} className={TROW}>
                      <td className="py-[9px] pr-3 pl-5 whitespace-nowrap">{stamp(c.changedAt)}</td>
                      <td className="px-3 py-[9px] font-semibold">{variantTitle.get(c.variantGid) ?? "—"}</td>
                      <td className="px-3 py-[9px] whitespace-nowrap tabular-nums">
                        {money.format(Number(c.oldPrice))} → {money.format(Number(c.newPrice))}
                      </td>
                      <td className="px-3 py-[9px]">
                        <Pill tone={tone}>{label}</Pill>
                      </td>
                      <td className="py-[9px] pr-5 pl-3 text-muted">
                        {REASONS[c.reason] ?? c.reason}
                        {c.error ? `: ${c.error}` : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

function Tile({ label, value, sub }) {
  return (
    <div className={`${CARD} px-4 py-3.5`}>
      <p className="m-0 text-xs text-muted">{label}</p>
      <p className="mt-1 mb-0 text-[22px] font-bold tabular-nums">{value}</p>
      <p className="m-0 text-xs text-muted">{sub}</p>
    </div>
  );
}

/**
 * The ladder as bars (the first variant's prices: start, then each step) with the floor as a dashed
 * line; with several variants, each one's prices in a table under it.
 */
function Ladder({ variants, applied, current, startedOn, ladder, money, running, paused, floorOf }) {
  const v = variants[0];
  // The current step shows what the app actually wrote (it can differ after a cost or settings change).
  const priceAt = (x, i) => (i === current && applied?.[x.id] ? applied[x.id].price : x.stepPrices[i]);
  const bars = [
    { label: "Start", when: running ? `Before ${shortDay(startedOn)}` : "Today", price: v.originalPrice, state: running && current >= 0 ? "done" : "live" },
    ...ladder.steps.map((d, i) => ({
      label: `Step ${i + 1} · −${Math.round(d * 100)}%`,
      when: i === current ? `Live since ${shortDay(addDays(startedOn, i * ladder.stepDays))}` : shortDay(addDays(startedOn, i * ladder.stepDays)),
      price: priceAt(v, i),
      state: i < current ? "done" : i === current ? "live" : "next",
    })),
  ];
  const floor = floorOf(v);
  const top = Math.max(...bars.map((b) => b.price), floor);
  const h = (price) => Math.max(4, Math.round((price / top) * CHART));
  // A paused plan takes no further steps.
  const next = running && !paused && current + 1 < ladder.steps.length ? current + 1 : null;
  const COLORS = { done: "bg-accent-line", live: "bg-accent", next: "border-2 border-dashed border-accent bg-white" };

  return (
    <section aria-labelledby="ladder" className={`${CARD} flex flex-col gap-3.5 px-5 py-[18px]`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="ladder" className={H2}>
          The ladder
        </h2>
        <span className="text-[13px] text-muted">
          {paused
            ? "Paused: no further steps"
            : current < 0 && running
              ? "Step 1 goes live within the hour"
              : next != null
                ? `Next step on ${shortDay(addDays(startedOn, next * ladder.stepDays))} · ${money.format(v.stepPrices[next])}`
                : running
                  ? "Last step is live"
                  : `Starts when you approve · one step every ${ladder.stepDays} days`}
        </span>
      </div>
      <div
        role="img"
        aria-label={`Prices${variants.length > 1 ? ` for ${v.title}` : ""}: ${bars.map((b) => `${b.label} ${money.format(b.price)}`).join(", ")}; never below ${money.format(floor)}`}
        className="relative grid h-[230px] grid-cols-4 items-end gap-3 border-b border-line px-2 sm:gap-6"
      >
        <div aria-hidden="true" className="absolute inset-x-0 border-t-2 border-dashed border-[#B91C1C]" style={{ bottom: `${h(floor)}px` }} />
        {/* Just under the line, so it never covers a step's price above it. */}
        <span aria-hidden="true" className="absolute right-3 z-10 bg-white px-1 text-xs font-bold text-[#B91C1C]" style={{ bottom: `${Math.max(2, h(floor) - 20)}px` }}>
          Floor {money.format(floor)}
        </span>
        {bars.map((b) => (
          <div key={b.label} className="flex flex-col items-center gap-1.5">
            <span className="text-xs font-bold tabular-nums sm:text-sm">{money.format(b.price)}</span>
            <div className={`box-border w-full max-w-[120px] rounded-t-lg ${COLORS[b.state]}`} style={{ height: `${h(b.price)}px` }} />
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="grid grid-cols-4 gap-3 px-2 text-center sm:gap-6">
        {bars.map((b) => (
          <div key={b.label} className="flex flex-col">
            <span className="text-[13px] font-semibold">{b.label}</span>
            <span className="text-xs text-muted">{b.when}</span>
          </div>
        ))}
      </div>
      {variants.length > 1 && (
        <>
          <p className="m-0 text-[13px] text-muted">The bars show {v.title}. Each variant has its own prices and floor:</p>
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-[13px]">
              <thead>
                <tr className={`${THEAD} text-left`}>
                  <th scope="col" className="py-2 pr-3 pl-5 font-semibold">
                    Variant
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    Start
                  </th>
                  {ladder.steps.map((d, i) => (
                    <th key={i} scope="col" className={`px-3 py-2 text-right font-semibold ${i === current ? "text-ink" : ""}`}>
                      −{Math.round(d * 100)}%
                    </th>
                  ))}
                  <th scope="col" className="py-2 pr-5 pl-3 text-right font-semibold">
                    Floor
                  </th>
                </tr>
              </thead>
              <tbody>
                {variants.map((x) => (
                  <tr key={x.id} className={TROW}>
                    <td className="py-2 pr-3 pl-5 font-semibold">{x.title}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money.format(x.originalPrice)}</td>
                    {x.stepPrices.map((_, i) => {
                      const p = priceAt(x, i);
                      return (
                        <td key={i} className={`px-3 py-2 text-right tabular-nums ${i === current ? "font-bold" : ""}`}>
                          {money.format(p)}
                          {p <= floorOf(x) ? " (floor)" : ""}
                        </td>
                      );
                    })}
                    <td className="py-2 pr-5 pl-3 text-right text-[#B91C1C] tabular-nums">{money.format(floorOf(x))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="m-0 text-xs text-muted">Later steps are recalculated against the live cost and your settings when they go live.</p>
    </section>
  );
}

/** "Rules for this product": the steps, cost, minimum margin with the floor, maximum discount, the end. */
function Rules({ data, plan, variants, money, floorOf }) {
  const settings = data.preview?.settings ?? data.rules;
  const costs = [...new Set(variants.map((v) => data.costs?.[v.id]).filter((c) => c != null))].sort((a, b) => a - b);
  const floors = [...new Set(variants.map(floorOf))].sort((a, b) => a - b);
  const range = (list) => (list.length === 0 ? "—" : list.length === 1 ? money.format(list[0]) : `${money.format(list[0])}–${money.format(list.at(-1))}`);
  // A running plan never goes deeper than it was approved for, nor than today's setting.
  const maxDiscount = plan ? Math.min(Number(plan.maxDiscountPct), settings?.maxDiscountPct ?? Infinity) : settings?.maxDiscountPct;
  const endAction = plan ? plan.endAction : settings?.endAction;
  const rows = [
    ["Steps", `${data.ladder.steps.map((d) => `${Math.round(d * 100)}%`).join(" → ")}, every ${data.ladder.stepDays} days`],
    ["Cost", range(costs)],
    ["Minimum margin", `${settings ? `${settings.marginFloorPct}% · ` : ""}floor ${range(floors)}`],
    ["Maximum discount", maxDiscount != null ? `${maxDiscount}%` : "—"],
    ["Stops", plan ? `when ${Math.ceil(plan.startStock * data.ladder.sellThroughStop).toLocaleString()} of ${plan.startStock.toLocaleString()} units have sold` : `when half the stock has sold`],
    ["At the end", endAction === "hold" ? "Keep the last price" : "Restore the original price"],
  ];
  return (
    <section aria-labelledby="rules" className={`${CARD} flex flex-col gap-2 px-5 py-[18px]`}>
      <h2 id="rules" className={H2}>
        Rules for this product
      </h2>
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
        {rows.map(([dt, dd]) => (
          <div key={dt} className="contents">
            <dt className="text-muted">{dt}</dt>
            <dd className="m-0 font-semibold">{dd}</dd>
          </div>
        ))}
      </dl>
      <p className="m-0 text-xs text-muted">
        Change the margin, discount and end in <Link href="/settings">Settings</Link>.
      </p>
    </section>
  );
}
