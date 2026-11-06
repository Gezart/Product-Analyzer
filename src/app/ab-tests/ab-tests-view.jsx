"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiError } from "@/app/api-error";
import { BTN, Card, CARD, H2, Notice, PageHeader, Pill, TH, THEAD, TROW, UpgradeNotice } from "@/app/ui/kit";
import { daysRunning, END_REASONS, KIND_LABELS } from "@/lib/ab-tests";
import { moneyFormatter } from "@/lib/status-info";
import { NewTest } from "./new-test";

const SUBTITLE = "Show half your visitors a new title, description or photo order at the same time. Keep the version that sells.";

const pct = (rate, digits = 1) => (rate == null ? "—" : `${(rate * 100).toFixed(digits)}%`);

/** "Leaves the app": the theme editor opens in the admin with the app embed ready to turn on. */
function openThemeEditor(url) {
  window.open(url, "_top");
}

const RESULT_TONE = { b_better: "good", a_better: "neutral", time: "neutral", stopped: "neutral", used_b: "good", changed: "warn", plan: "warn", product_gone: "warn" };

/** The result line of an ended test. */
function resultLabel(test) {
  if (test.endReason === "time") return test.winner === "b" ? "B did better" : test.winner === "a" ? "A did better" : "No clear winner";
  return END_REASONS[test.endReason] ?? "Ended";
}

async function post(url) {
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) throw await apiError(res);
  return res.json();
}

/** A/B tests: the running tests with their numbers and chance, a new test, and the finished ones. */
export function AbTestsView() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [message, setMessage] = useState(null);
  const [form, setForm] = useState(null); // null (closed) | { productId }
  const [busy, setBusy] = useState(null);

  async function load() {
    try {
      const res = await fetch("/api/ab-tests");
      if (!res.ok) throw await apiError(res);
      setData(await res.json());
      setLoadError(null);
    } catch (e) {
      setLoadError(e.message);
    }
  }

  useEffect(() => {
    load();
    // From a product's page: open a new test for it.
    const product = new URLSearchParams(window.location.search).get("product");
    if (product) setForm({ productId: product });
  }, []);

  async function act(test, action) {
    setBusy(`${test.id}:${action}`);
    setMessage(null);
    try {
      await post(`/api/ab-tests/${test.id}/${action}`);
      setMessage({
        tone: "good",
        text: action === "use-b" ? `B is now on ${test.product.title} in Shopify. It's measured like any fix, and you can undo it on the product's page.` : `Stopped. Every visitor sees ${test.product.title} as it is again.`,
      });
      await load();
    } catch (e) {
      setMessage({ tone: "bad", text: e.message });
    } finally {
      setBusy(null);
    }
  }

  const locked = Boolean(data?.upgrade);
  const running = data?.tests.filter((t) => t.status === "running") ?? [];
  const finished = data?.tests.filter((t) => t.status !== "running") ?? [];
  const money = moneyFormatter(data?.currency, 2);

  const actions = data && (
    <>
      <button type="button" onClick={() => openThemeEditor(data.themeEditorUrl)} className={`${BTN.secondary} cursor-pointer`}>
        Turn on in theme
      </button>
      <button type="button" disabled={locked} onClick={() => setForm({ productId: null })} className={`${BTN.primary} cursor-pointer`}>
        New test
      </button>
    </>
  );

  return (
    <>
      <PageHeader title="A/B tests" subtitle={SUBTITLE} actions={actions} />
      {loadError && <Notice tone="bad">{loadError}</Notice>}
      {!data && !loadError && <p className="m-0 text-muted">Loading your tests…</p>}
      {locked && <UpgradeNotice>{data.error}</UpgradeNotice>}
      {message && (
        <Notice tone={message.tone} compact role={message.tone === "bad" ? "alert" : "status"}>
          {message.text}
        </Notice>
      )}

      {form && !locked && (
        <NewTest
          key={form.productId ?? "new"}
          productId={form.productId}
          onClose={() => setForm(null)}
          onStarted={(title) => {
            setForm(null);
            setMessage({ tone: "good", text: `The test on ${title} is running. Half the visitors who allow tracking now see B.` });
            load();
          }}
        />
      )}

      {data && (
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(260px,1fr)]">
          <div className="flex min-w-0 flex-col gap-3">
            {running.length === 0 && (
              <Notice compact>No test is running. Start one with New test: pick a product and write its version B.</Notice>
            )}
            {running.map((test) => (
              <RunningTest key={test.id} test={test} rules={data.rules} money={money} busy={busy} locked={locked} onAct={act} />
            ))}
            {finished.length > 0 && <FinishedTests tests={finished} busy={busy} onAct={act} />}
          </div>
          <HowItWorks rules={data.rules} />
        </div>
      )}
    </>
  );
}

function Version({ label, version, kind }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-semibold text-muted">{label}</span>
      {kind === "images" ? (
        <span className="flex gap-1.5">
          {version.photos.map((url, i) => (
            <span key={i} className="size-12 shrink-0 overflow-hidden rounded-md border border-line bg-head">
              {url && <img src={url} alt="" className="size-full object-cover" />}
            </span>
          ))}
        </span>
      ) : (
        <span className="line-clamp-3 text-[13px]">{version.text || "—"}</span>
      )}
    </div>
  );
}

function ChanceBar({ chance }) {
  const value = chance == null ? 0 : Math.round(chance * 100);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold">Chance B is better</span>
        <span className="text-lg font-bold">{chance == null ? "—" : `${value}%`}</span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-head" role="img" aria-label={chance == null ? "Not known yet" : `${value}% chance B is better`}>
        <div className={`h-full rounded-full ${value >= 95 ? "bg-[#059669]" : value <= 5 ? "bg-[#B91C1C]" : "bg-accent"}`} style={{ width: `${value}%` }} />
        <span className="absolute top-0 left-[95%] h-full w-px bg-ink/40" aria-hidden="true" />
      </div>
    </div>
  );
}

function RunningTest({ test, rules, money, busy, locked, onAct }) {
  const [confirm, setConfirm] = useState(false);
  const { a, b, chance } = test.stats;
  const day = daysRunning(test.startedAt, new Date()) + 1;
  const short = Math.max(0, rules.minVisitors - Math.min(a.visitors, b.visitors));
  const rows = [
    ["Visitors", a.visitors.toLocaleString(), b.visitors.toLocaleString()],
    ["Added to cart", `${a.carts.toLocaleString()} · ${pct(a.cartRate)}`, `${b.carts.toLocaleString()} · ${pct(b.cartRate)}`],
    ["Bought", `${a.buyers.toLocaleString()} · ${pct(a.conversion)}`, `${b.buyers.toLocaleString()} · ${pct(b.conversion)}`],
    ["Revenue", money.format(a.revenue), money.format(b.revenue)],
  ];
  const best = (i) => {
    const [x, y] = i === 1 ? [a.cartRate, b.cartRate] : i === 2 ? [a.conversion, b.conversion] : i === 3 ? [a.revenue, b.revenue] : [null, null];
    return x == null || y == null || x === y ? null : y > x ? "b" : "a";
  };

  return (
    <section className={`${CARD} flex flex-col gap-4 px-5 py-4`} aria-label={`Test on ${test.product.title}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Link href={`/products/${test.product.id}`} className={`${H2} text-ink no-underline hover:underline`}>
            {test.product.title}
          </Link>
          <Pill tone="info">{KIND_LABELS[test.kind]}</Pill>
          <span className="text-[13px] text-muted">
            Running · day {Math.min(day, rules.maxDays)} of {rules.maxDays}
          </span>
        </div>
        {confirm ? (
          <span className="flex flex-wrap items-center gap-2 text-[13px]">
            Put B on the product in Shopify?
            <button type="button" disabled={Boolean(busy)} onClick={() => onAct(test, "use-b")} className={`${BTN.smallPrimary} cursor-pointer`}>
              {busy === `${test.id}:use-b` ? "Applying…" : "Yes, use B"}
            </button>
            <button type="button" onClick={() => setConfirm(false)} className={`${BTN.small} cursor-pointer`}>
              Cancel
            </button>
          </span>
        ) : (
          <span className="flex gap-2">
            <button type="button" disabled={Boolean(busy)} onClick={() => onAct(test, "stop")} className={`${BTN.small} cursor-pointer`}>
              {busy === `${test.id}:stop` ? "Stopping…" : "Stop test"}
            </button>
            <button type="button" disabled={Boolean(busy) || locked} onClick={() => setConfirm(true)} className={`${BTN.smallPrimary} cursor-pointer`}>
              Use B now
            </button>
          </span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Version label="A · as it is" version={test.a} kind={test.kind} />
        <Version label="B" version={test.b} kind={test.kind} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead className={THEAD}>
            <tr>
              <th className={TH} scope="col">
                <span className="sr-only">Number</span>
              </th>
              <th className={TH} scope="col">
                A
              </th>
              <th className={TH} scope="col">
                B
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, x, y], i) => (
              <tr key={label} className={TROW}>
                <th scope="row" className="px-3 py-[9px] text-left font-medium text-muted">
                  {label}
                </th>
                <td className={`px-3 py-[9px] ${best(i) === "a" ? "font-bold" : ""}`}>{x}</td>
                <td className={`px-3 py-[9px] ${best(i) === "b" ? "font-bold" : ""}`}>{y}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ChanceBar chance={chance} />
      <p className="m-0 text-[13px] text-muted">
        {a.visitors + b.visitors === 0
          ? "No visitors counted yet. If none come within a day, check that the A/B tests app embed is on in your theme."
          : a.visitors >= 30 && b.visitors === 0
            ? "B hasn't been shown yet: your theme may show this part of the page in a way the test can't find. Try another kind of test on this product."
            : short > 0 || day <= rules.minDays
              ? `It can stop early once each version has ${rules.minVisitors} visitors${short > 0 ? ` (${short} more needed)` : ""} after ${rules.minDays} days; otherwise it stops after ${rules.maxDays} days.`
              : `It stops when the chance reaches ${Math.round(rules.threshold * 100)}% either way, or after ${rules.maxDays} days.`}
      </p>
    </section>
  );
}

function FinishedTests({ tests, busy, onAct }) {
  const [confirm, setConfirm] = useState(null);
  return (
    <Card heading="Finished tests">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead className={THEAD}>
            <tr>
              <th className={TH} scope="col">
                Product
              </th>
              <th className={`${TH} hidden sm:table-cell`} scope="col">
                Test
              </th>
              <th className={TH} scope="col">
                Result
              </th>
              <th className={`${TH} hidden sm:table-cell`} scope="col">
                Chance B better
              </th>
              <th className={TH} scope="col">
                <span className="sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {tests.map((test) => (
              <tr key={test.id} className={TROW}>
                <td className="px-3 py-[9px]">
                  <Link href={`/products/${test.product.id}`}>{test.product.title}</Link>
                  <span className="block text-xs text-muted">
                    <span className="sm:hidden">{KIND_LABELS[test.kind]} · </span>
                    {new Date(test.startedAt).toLocaleDateString()} – {test.endedAt ? new Date(test.endedAt).toLocaleDateString() : "…"}
                  </span>
                </td>
                <td className="hidden px-3 py-[9px] sm:table-cell">{KIND_LABELS[test.kind]}</td>
                <td className="px-3 py-[9px]">
                  <Pill tone={test.status === "applied" ? "good" : (RESULT_TONE[test.endReason] ?? "neutral")}>
                    {test.status === "applied" ? "B is in use" : test.status === "applying" ? "Applying B…" : resultLabel(test)}
                  </Pill>
                </td>
                <td className="hidden px-3 py-[9px] sm:table-cell">{test.stats?.chance == null ? "—" : pct(test.stats.chance, 0)}</td>
                <td className="px-3 py-[9px] text-right">
                  {test.status === "ended" && test.endReason !== "product_gone" && confirm !== test.id && (
                    <button type="button" disabled={Boolean(busy)} onClick={() => setConfirm(test.id)} className={`${BTN.tiny} cursor-pointer`}>
                      Use B now
                    </button>
                  )}
                  {confirm === test.id && (
                    <span className="flex flex-col items-end gap-1">
                      <span className="text-xs text-muted">{test.winner === "b" ? "Put B on the product?" : "B didn't win. Put it on the product anyway?"}</span>
                      <span className="flex gap-1.5">
                        <button type="button" disabled={Boolean(busy)} onClick={() => onAct(test, "use-b")} className={`${BTN.tiny} cursor-pointer`}>
                          {busy === `${test.id}:use-b` ? "Applying…" : "Yes"}
                        </button>
                        <button type="button" onClick={() => setConfirm(null)} className={`${BTN.tiny} cursor-pointer`}>
                          No
                        </button>
                      </span>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function HowItWorks({ rules }) {
  return (
    <section className={`${CARD} flex flex-col gap-2 px-5 py-4 text-[13px] text-ink-2`}>
      <h2 className={H2}>How a test works</h2>
      <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5">
        <li>Each visitor who allows tracking sees A or B, half each, and keeps seeing the same one. Others see your page as it is and aren&apos;t counted.</li>
        <li>Views and add-to-carts are counted on the product page; purchases come from your orders.</li>
        <li>
          <strong>Chance B is better</strong>: how likely B gets more add-to-carts per visitor than A.
        </li>
        <li>
          It stops at {Math.round(rules.threshold * 100)}% either way once each version has {rules.minVisitors} visitors and it ran {rules.minDays} days, or after {rules.maxDays} days.
        </li>
        <li>
          <strong>Use B now</strong> puts B on the product in Shopify as a fix: with Undo, and measured like any fix.
        </li>
        <li>
          Needs the <strong>A/B tests</strong> app embed on in your theme (Turn on in theme). Your theme&apos;s code isn&apos;t changed.
        </li>
      </ul>
    </section>
  );
}
