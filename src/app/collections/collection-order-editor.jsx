"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BTN, CARD, H2, Notice, Pill, THEAD, TROW } from "@/app/ui/kit";
import { dragMove, moveLabel } from "@/lib/collections-page";
import { moneyFormatter, STATUS_INFO } from "@/lib/status-info";

const STATUS_LABEL = { applying: "saving", applied: "applied", undoing: "undoing", undone: "undone", failed: "failed" };
const MOVE_TONES = { good: "text-[#047857]", warn: "text-[#B45309]", muted: "text-muted" };
const day = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const ARROW = "cursor-pointer rounded border border-line-strong bg-white px-1 text-[11px] leading-[18px] text-ink-2 disabled:cursor-default disabled:opacity-30";

/**
 * One collection's proposed order (the owner's design): drag rows (or ↑ ↓) to change it, "Confirm and
 * apply" writes it to Shopify; the latest saved order can be undone. `collectionId` is the numeric Shopify id.
 */
export function CollectionOrderEditor({ collectionId, onUpgrade, onSkip, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [order, setOrder] = useState([]);
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [over, setOver] = useState(null);

  /** Reads the collection again; `keepOrder` keeps the merchant's edited order (after a failed save). */
  const load = useCallback(
    async ({ keepOrder = false } = {}) => {
      const res = await fetch(`/api/collection-order/${encodeURIComponent(collectionId)}`).catch(() => null);
      const body = res ? await res.json().catch(() => ({})) : {};
      if (res?.status === 403 && body.upgrade) {
        onUpgrade(body.error);
        return setData({ proposal: null, history: [], collection: { title: "" } }); // nothing saved here to undo
      }
      if (!res?.ok) return setError(body.error ?? `Failed (${res?.status ?? "network"})`);
      setError(null);
      setData(body);
      // An edited order is kept only while it still fits the collection (same products).
      setOrder((prev) => {
        const ids = (body.proposal ?? []).map((p) => p.id);
        return keepOrder && prev.length === ids.length && prev.every((id) => ids.includes(id)) ? prev : ids;
      });
    },
    [collectionId, onUpgrade],
  );

  useEffect(() => {
    load();
  }, [load]);

  if (error && !data) return <Notice tone="bad">{error}</Notice>;
  if (!data) return <p className="m-0 text-muted">Loading the proposed order…</p>;

  async function post(kind, url, body) {
    setBusy(kind);
    setMessage(null);
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const out = res ? await res.json().catch(() => ({})) : {};
    setBusy(null);
    return { ok: Boolean(res?.ok), status: res?.status, body: out };
  }

  async function save() {
    const r = await post("save", `/api/collection-order/${encodeURIComponent(collectionId)}`, { order, expected: data.current });
    if (!r.ok) setMessage({ tone: "bad", text: r.body.error ?? `Failed (${r.status ?? "network"})` });
    else {
      const note = r.body.pending ? " Shopify is still finishing it; it can take a minute to show in your store." : "";
      setMessage({ tone: "good", text: `Applied: ${r.body.moved} products moved in "${data.collection.title}". The old order is kept; you can undo it below.${note}` });
    }
    await load({ keepOrder: !r.ok });
    onChanged?.();
  }

  async function undo(id, force = false) {
    const r = await post(id, `/api/collection-reorders/${id}/undo`, { force });
    if (r.status === 409 && !force && /changed since/.test(r.body.error ?? "")) return setMessage({ tone: "bad", text: r.body.error, forceUndo: id });
    if (!r.ok) setMessage({ tone: "bad", text: r.body.error ?? `Failed (${r.status ?? "network"})` });
    else setMessage({ tone: "good", text: `Undone: "${data.collection.title}" is back in the order it had before.${r.body.pending ? " Shopify is still finishing it." : ""}` });
    await load();
    onChanged?.();
  }

  const banner = message && (
    <Notice tone={message.tone} compact>
      {message.text}{" "}
      {message.forceUndo && (
        <button type="button" disabled={busy !== null} onClick={() => undo(message.forceUndo, true)} className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] font-semibold underline">
          Undo anyway
        </button>
      )}
    </Notice>
  );
  const saves = <Saves history={data.history} title={data.collection.title} busy={busy} onUndo={undo} />;

  // A plan without the optimizer: its saved orders can still be undone.
  if (!data.proposal) {
    return (
      <>
        {banner}
        {saves}
      </>
    );
  }

  const money = moneyFormatter(data.currency);
  const byId = new Map(data.proposal.map((p) => [p.id, p]));
  const proposed = data.proposal.map((p) => p.id);
  const changed = order.some((id, i) => data.current[i] !== id);
  const moved = order.filter((id, i) => data.current[i] !== id).length;
  const edited = order.some((id, i) => proposed[i] !== id);
  const move = (from, to) => setOrder((o) => dragMove(o, from, to));

  return (
    <>
      <section aria-labelledby="prop" className={`${CARD} overflow-hidden`}>
        <div className="flex flex-col gap-2 px-5 pt-4 pb-2.5">
          <div>
            <h2 id="prop" className={H2}>
              {data.collection.title} · proposed order
            </h2>
            <p className="mt-0.5 mb-0 text-[13px] text-muted">
              {changed
                ? `Moves ${moved} of ${order.length} products${edited ? ", with your changes" : ""}. Best sellers keep the first places; hidden gems and products that need sales come next; page problems, out-of-season, sold-out and not-on-sale products go last.`
                : "This is the collection's current order: nothing to move."}
            </p>
          </div>
          {banner}
          {error && <Notice tone="bad" compact>{error}</Notice>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-[13px]">
            <thead>
              <tr className={`${THEAD} text-left`}>
                <th scope="col" className="py-2 pr-3 pl-5 font-semibold">
                  Product
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Status
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  Now
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  New
                </th>
                <th scope="col" className="py-2 pr-5 pl-3 text-right font-semibold">
                  Move
                </th>
              </tr>
            </thead>
            <tbody>
              {order.map((id, i) => {
                const p = byId.get(id);
                const m = moveLabel(p.from, i);
                return (
                  <tr
                    key={id}
                    draggable={busy === null}
                    onDragStart={(e) => {
                      setDragging(i);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => {
                      if (dragging == null) return;
                      e.preventDefault();
                      setOver(i);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragging != null) move(dragging, i);
                      setDragging(null);
                      setOver(null);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                    className={`${TROW} ${over === i && dragging !== i ? "bg-accent-soft" : ""} ${dragging === i ? "opacity-50" : ""}`}
                  >
                    <td className="py-[9px] pr-3 pl-5">
                      <span className="flex items-center gap-2">
                        <span aria-hidden="true" className="cursor-grab text-[#A3A9B3] select-none">
                          ⋮⋮
                        </span>
                        <span className="flex flex-none gap-0.5">
                          <button type="button" disabled={i === 0 || busy !== null} onClick={() => move(i, i - 1)} className={ARROW} aria-label={`Move ${p.title} up`}>
                            ↑
                          </button>
                          <button type="button" disabled={i === order.length - 1 || busy !== null} onClick={() => move(i, i + 1)} className={ARROW} aria-label={`Move ${p.title} down`}>
                            ↓
                          </button>
                        </span>
                        <span className="flex min-w-0 flex-col">
                          {p.productId ? (
                            <Link href={`/products/${p.productId}`} className="font-semibold text-ink no-underline hover:text-ink hover:underline">
                              {p.title}
                            </Link>
                          ) : (
                            <span className="font-semibold">{p.title}</span>
                          )}
                          <span className="text-xs text-muted">
                            {proposed[i] === id ? p.reason : `${p.reason} (placed by you)`} · {money.format(p.revenue30)} in 30 days
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-[9px]">{p.status ? <Pill tone={p.status}>{STATUS_INFO[p.status]?.label ?? p.status}</Pill> : <span className="text-muted">—</span>}</td>
                    <td className="px-3 py-[9px] text-right text-muted tabular-nums">{p.from + 1}</td>
                    <td className="px-3 py-[9px] text-right font-bold tabular-nums">{i + 1}</td>
                    <td className={`py-[9px] pr-5 pl-3 text-right font-semibold tabular-nums ${MOVE_TONES[m.tone]}`}>{m.text}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-hair px-5 pt-3 pb-4">
          <p className="m-0 text-[13px] text-ink-2">Drag rows (or use ↑ ↓) to change the order. The old order is kept for Undo.</p>
          <div className="flex flex-wrap gap-2">
            {edited && (
              <button type="button" disabled={busy !== null} onClick={() => setOrder(proposed)} className={`${BTN.secondary} cursor-pointer`}>
                Back to the proposal
              </button>
            )}
            {onSkip && (
              <button type="button" disabled={busy !== null} onClick={onSkip} className={`${BTN.secondary} cursor-pointer`}>
                Skip
              </button>
            )}
            <button type="button" disabled={!changed || busy !== null} onClick={save} className={`${BTN.primary} cursor-pointer`}>
              {busy === "save" ? "Applying…" : "Confirm and apply"}
            </button>
          </div>
        </div>
      </section>
      {saves}
    </>
  );
}

/** The latest applied order (measured on the moved products' own pages) with Undo, and the earlier saves. */
function Saves({ history, title, busy, onUndo }) {
  if (!history.length) return null;
  const [latest, ...earlier] = history;
  const applied = latest.status === "applied";
  return (
    <section aria-labelledby="meas" className={`${CARD} flex flex-col gap-3 px-5 py-4`}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-[1_1_360px]">
          <h2 id="meas" className={H2}>
            {title ? `${title} · ` : ""}
            {applied ? "applied" : `last order ${STATUS_LABEL[latest.status] ?? latest.status}`}
          </h2>
          <p className="mt-0.5 mb-0 text-[13px] text-muted">
            {applied
              ? `New order applied on ${day(latest.appliedAt ?? latest.createdAt)}. ${latest.moved} product${latest.moved === 1 ? "" : "s"} moved. Products moved up are measured on their own pages: a rescue plan compares their sales over 14–30 days.`
              : `${latest.moved} product${latest.moved === 1 ? "" : "s"} moved on ${day(latest.createdAt)}.`}
          </p>
          {latest.error && <p className="mt-1 mb-0 text-[13px] text-[#B91C1C]">{latest.error}</p>}
        </div>
        {applied && (
          <button type="button" disabled={busy !== null} onClick={() => onUndo(latest.id)} className={`${BTN.secondary} cursor-pointer`}>
            {busy === latest.id ? "Undoing…" : "Undo order"}
          </button>
        )}
      </div>
      {earlier.length > 0 && (
        <ul className="m-0 flex list-none flex-col p-0 text-[13px]">
          {earlier.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-2 border-t border-hair py-2">
              <span className="min-w-0 flex-1">
                {h.moved} moved · <span className="text-muted">{day(h.appliedAt ?? h.createdAt)} · {STATUS_LABEL[h.status] ?? h.status}</span>
                {h.error && <span className="block text-xs text-[#B91C1C]">{h.error}</span>}
              </span>
              {h.status === "applied" && (
                <button type="button" disabled={busy !== null} onClick={() => onUndo(h.id)} className={`${BTN.tiny} cursor-pointer`}>
                  {busy === h.id ? "Undoing…" : "Undo"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
