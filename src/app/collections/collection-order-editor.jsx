"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { listen } from "@/app/polaris-events";
import { moneyFormatter, STATUS_INFO } from "@/lib/status-info";

const STATUS_LABEL = { applying: "saving", applied: "saved", undoing: "undoing", undone: "undone", failed: "failed" };

/**
 * One collection's proposed order, editable by hand (↑ ↓), saved to Shopify only after the merchant
 * confirms, with its saved orders and Undo. `collectionId` is the numeric Shopify id.
 */
export function CollectionOrderEditor({ collectionId, onUpgrade }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [order, setOrder] = useState([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);

  /** Reads the collection again; `keepOrder` keeps the merchant's edited order (after a failed save). */
  const load = useCallback(async ({ keepOrder = false } = {}) => {
    const res = await fetch(`/api/collection-order/${encodeURIComponent(collectionId)}`).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    if (res?.status === 403 && body.upgrade) {
      onUpgrade(body.error);
      return setData({ proposal: null, history: [] }); // nothing saved here to undo
    }
    if (!res?.ok) return setError(body.error ?? `Failed (${res?.status ?? "network"})`);
    setError(null);
    setData(body);
    // An edited order is kept only while it still fits the collection (same products).
    setOrder((prev) => {
      const ids = (body.proposal ?? []).map((p) => p.id);
      return keepOrder && prev.length === ids.length && prev.every((id) => ids.includes(id)) ? prev : ids;
    });
    setConfirming(false);
  }, [collectionId, onUpgrade]);

  useEffect(() => {
    load();
  }, [load]);

  if (error && !data) return <s-banner tone="critical">{error}</s-banner>;
  if (!data) return <s-spinner accessibilityLabel="Loading the proposed order" />;

  const history = (
    data.history.length > 0 && (
      <s-stack gap="small">
        <s-text>Saved orders</s-text>
        <ul className="m-0 list-none space-y-1 p-0 text-sm">
          {data.history.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-2">
              <span>{h.moved} products moved</span>
              <s-badge tone={h.status === "applied" ? "success" : h.status === "failed" ? "critical" : undefined}>{STATUS_LABEL[h.status] ?? h.status}</s-badge>
              <span className="text-zinc-500">{new Date(h.appliedAt ?? h.createdAt).toLocaleString()}</span>
              {h.error && <span className="text-red-700">{h.error}</span>}
              {h.status === "applied" && (
                <s-button variant="tertiary" disabled={busy !== null || undefined} loading={busy === h.id || undefined} ref={listen("click", () => undo(h.id))}>
                  Undo
                </s-button>
              )}
            </li>
          ))}
        </ul>
      </s-stack>
    )
  );
  const banner = message && (
    <s-banner tone={message.tone}>
      {message.text}
      {message.forceUndo && (
        <s-button variant="tertiary" disabled={busy !== null || undefined} ref={listen("click", () => undo(message.forceUndo, true))}>
          Undo anyway
        </s-button>
      )}
    </s-banner>
  );
  // A plan without the optimizer: its saved orders can still be undone.
  if (!data.proposal) {
    return (
      <s-stack gap="base">
        {banner}
        {history}
      </s-stack>
    );
  }

  const money = moneyFormatter(data.currency);
  const byId = new Map(data.proposal.map((p) => [p.id, p]));
  const proposed = data.proposal.map((p) => p.id);
  const changed = order.some((id, i) => data.current[i] !== id);
  const moved = order.filter((id, i) => data.current[i] !== id).length;
  const edited = order.some((id, i) => proposed[i] !== id);

  function move(i, step) {
    const next = [...order];
    const [id] = next.splice(i, 1);
    next.splice(i + step, 0, id);
    setOrder(next);
    setConfirming(false);
  }

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
    await load({ keepOrder: !r.ok });
    if (!r.ok) return setMessage({ tone: "critical", text: r.body.error ?? `Failed (${r.status})` });
    const note = r.body.pending ? " Shopify is still finishing it; it can take a minute to show in your store." : "";
    setMessage({ tone: "success", text: `Saved: ${r.body.moved} products moved in "${data.collection.title}". The old order is kept; you can undo it below.${note}` });
  }

  async function undo(id, force = false) {
    const r = await post(id, `/api/collection-reorders/${id}/undo`, { force });
    if (r.status === 409 && !force && /changed since/.test(r.body.error ?? "")) return setMessage({ tone: "critical", text: r.body.error, forceUndo: id });
    await load();
    if (!r.ok) return setMessage({ tone: "critical", text: r.body.error ?? `Failed (${r.status})` });
    setMessage({ tone: "success", text: `Undone: "${data.collection.title}" is back in the order it had before.${r.body.pending ? " Shopify is still finishing it." : ""}` });
  }

  return (
    <s-stack gap="base">
      {banner}
      {error && <s-banner tone="critical">{error}</s-banner>}
      <s-text tone="neutral">
        {!changed
          ? "This is the collection's current order."
          : `Moves ${moved} of ${order.length} products${edited ? ", with your changes" : ""}. Bestsellers first, then hidden gems and products that need sales; page problems, out-of-season, sold-out and not-on-sale products last. Use ↑ ↓ to change it.`}
      </s-text>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="text-zinc-500">
            <tr>
              <th className="py-1 pr-3 font-medium">New</th>
              <th className="py-1 pr-3 font-medium">Now</th>
              <th className="py-1 pr-3 font-medium">Product</th>
              <th className="py-1 pr-3 font-medium">Status</th>
              <th className="py-1 pr-3 text-right font-medium">Sales, 30 days</th>
              <th className="py-1 pr-3 font-medium">Why here</th>
              <th className="py-1 font-medium">
                <span className="sr-only">Move</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {order.map((id, i) => {
              const p = byId.get(id);
              const delta = p.from - i;
              return (
                <tr key={id} className="border-t border-zinc-100">
                  <td className="py-1.5 pr-3 tabular-nums">{i + 1}</td>
                  <td className="py-1.5 pr-3 tabular-nums text-zinc-500">
                    {p.from + 1}
                    {delta !== 0 && <span className={delta > 0 ? "ml-1 text-emerald-700" : "ml-1 text-zinc-400"}>{delta > 0 ? `↑${delta}` : `↓${-delta}`}</span>}
                  </td>
                  <td className="py-1.5 pr-3">{p.productId ? <Link href={`/products/${p.productId}`} className="underline">{p.title}</Link> : p.title}</td>
                  <td className="py-1.5 pr-3">
                    {p.status ? <s-badge tone={STATUS_INFO[p.status]?.tone}>{STATUS_INFO[p.status]?.label ?? p.status}</s-badge> : <span className="text-zinc-400">—</span>}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{money.format(p.revenue30)}</td>
                  <td className="py-1.5 pr-3 text-zinc-600">{proposed[i] === id ? p.reason : `${p.reason} (placed by you)`}</td>
                  <td className="py-1.5">
                    <div className="flex gap-1 text-xs">
                      <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="rounded border px-1 disabled:opacity-30" aria-label={`Move ${p.title} up`}>
                        ↑
                      </button>
                      <button type="button" disabled={i === order.length - 1} onClick={() => move(i, 1)} className="rounded border px-1 disabled:opacity-30" aria-label={`Move ${p.title} down`}>
                        ↓
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {confirming ? (
        <s-banner tone="warning">
          Save this order to Shopify? Shoppers will see the {moved} moved products in their new places in &quot;{data.collection.title}&quot;. You can undo it.
          <s-stack direction="inline" gap="small">
            <s-button variant="primary" loading={busy === "save" || undefined} disabled={busy !== null || undefined} ref={listen("click", save)}>
              Yes, save it
            </s-button>
            <s-button variant="secondary" disabled={busy !== null || undefined} ref={listen("click", () => setConfirming(false))}>
              Cancel
            </s-button>
          </s-stack>
        </s-banner>
      ) : (
        <s-stack direction="inline" gap="small">
          <s-button variant="primary" disabled={!changed || busy !== null || undefined} ref={listen("click", () => setConfirming(true))}>
            Save order to Shopify
          </s-button>
          {edited && (
            <s-button variant="tertiary" disabled={busy !== null || undefined} ref={listen("click", () => setOrder(proposed))}>
              Back to the proposal
            </s-button>
          )}
        </s-stack>
      )}

      {history}
    </s-stack>
  );
}
