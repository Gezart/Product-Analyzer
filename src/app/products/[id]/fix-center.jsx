"use client";

import { useCallback, useEffect, useState } from "react";
import { listen } from "@/app/polaris-events";
import { UpgradeBanner } from "@/app/upgrade-banner";

const LABELS = { title: "Title", description: "Description", seo: "SEO", images: "Image order", collection: "Collections" };

/** Edit, apply and undo fixes. Every apply saves the old version first; undo restores it exactly. */
export function FixCenter({ productId, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);
  // Drafts per fix type.
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");
  const [mediaIds, setMediaIds] = useState([]);
  const [collectionIds, setCollectionIds] = useState([]);

  /** Refreshes live data and history; drafts are reset only for the listed types (unsaved edits stay). */
  const load = useCallback(
    async (reset) => {
      const res = await fetch(`/api/products/${productId}/fix-center`);
      if (!res.ok) return setError(res.status === 404 ? "Product not found in Shopify" : `Could not load (${res.status})`);
      const d = await res.json();
      setData(d);
      if (reset.includes("title")) setTitle(d.live.title);
      if (reset.includes("description")) setDescription(d.live.descriptionHtml);
      if (reset.includes("seo")) {
        setSeoTitle(d.live.seo.title ?? "");
        setSeoDescription(d.live.seo.description ?? "");
      }
      if (reset.includes("images")) setMediaIds(d.live.media.map((m) => m.id));
      if (reset.includes("collection")) setCollectionIds(d.live.collections.filter((c) => c.manual).map((c) => c.id));
    },
    [productId],
  );

  useEffect(() => {
    load(Object.keys(LABELS));
  }, [load]);

  // The state this page shows, so the server can refuse if Shopify changed meanwhile.
  function loadedState(type) {
    const live = data.live;
    switch (type) {
      case "title": return { title: live.title };
      case "description": return { descriptionHtml: live.descriptionHtml };
      case "seo": return { seoTitle: live.seo.title ?? "", seoDescription: live.seo.description ?? "" };
      case "images": return { mediaIds: live.media.map((m) => m.id) };
      default: return { collectionIds: live.collections.filter((c) => c.manual).map((c) => c.id).sort() };
    }
  }

  async function apply(type, after) {
    if (busy) return;
    setBusy(type);
    setMessage(null);
    const res = await fetch(`/api/products/${productId}/fixes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, after, expected: loadedState(type), diagnosisId: data?.diagnosisId }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    // Keep the merchant's text on failure; on success only the applied section is reset.
    await load(res.ok ? [type] : []);
    if (!res.ok) return setMessage({ tone: "critical", text: body.error ?? `Failed (${res.status})` });
    const note = body.pending ? " Shopify is still finishing it; it can take a minute to show." : "";
    setMessage({ tone: "success", text: `${LABELS[type]} updated in Shopify. The old version is saved; you can undo it below.${note}` });
    onChanged();
  }

  async function undo(fixId, force = false) {
    if (busy) return;
    setBusy(fixId);
    setMessage(null);
    const res = await fetch(`/api/fixes/${fixId}/undo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (res.status === 409 && !force && /changed since/.test(body.error ?? "")) {
      return setMessage({ tone: "critical", text: body.error, forceFix: fixId });
    }
    const undone = data?.fixes.find((f) => f.id === fixId)?.type;
    await load(res.ok && undone ? [undone] : []);
    if (!res.ok) return setMessage({ tone: "critical", text: body.error ?? `Failed (${res.status})` });
    const note = body.pending ? " Shopify is still finishing it; it can take a minute to show." : "";
    setMessage({ tone: "success", text: `Undone: the product is back to how it was before the fix.${note}` });
    onChanged();
  }

  const move = (i, delta) => {
    const next = [...mediaIds];
    const [item] = next.splice(i, 1);
    next.splice(i + delta, 0, item);
    setMediaIds(next);
  };

  if (error) return <s-section heading="Fix center"><s-banner tone="critical">{error}</s-banner></s-section>;
  if (!data) return <s-section heading="Fix center"><s-spinner accessibilityLabel="Loading fix center" /></s-section>;

  const button = (type, after, changed) => (
    <s-button variant="primary" disabled={!changed || busy !== null || data.upgrade != null || undefined} loading={busy === type || undefined} ref={listen("click", () => apply(type, after))}>
      Apply to Shopify
    </s-button>
  );
  const smart = data.live.collections.filter((c) => !c.manual);
  const mediaById = new Map(data.live.media.map((m) => [m.id, m]));
  const hintFor = (type) => data.hints.filter((h) => h.type === type).map((h) => <s-text key={h.code} tone="neutral">💡 {h.hint}</s-text>);

  return (
    <s-section heading="Fix center">
      <s-stack gap="base">
        {data.upgrade && <UpgradeBanner>{data.upgrade.reason}</UpgradeBanner>}
        {message && (
          <s-banner tone={message.tone}>
            {message.text}{" "}
            {message.forceFix && (
              <s-button variant="tertiary" disabled={busy !== null || undefined} ref={listen("click", () => undo(message.forceFix, true))}>
                Undo anyway
              </s-button>
            )}
          </s-banner>
        )}

        <s-stack gap="small">
          <s-text-field label="Title" value={title} ref={listen("input", (el) => setTitle(el.value))} />
          {hintFor("title")}
          <div>{button("title", { title }, title.trim() !== data.live.title && title.trim().length > 0 && title.trim().length <= 255)}</div>
        </s-stack>

        <s-stack gap="small">
          <s-text-area label="Description (HTML)" rows={8} value={description} ref={listen("input", (el) => setDescription(el.value))} />
          {hintFor("description")}
          <div>{button("description", { descriptionHtml: description }, description !== data.live.descriptionHtml)}</div>
        </s-stack>

        <s-stack gap="small">
          <s-text-field label="SEO title" details={`${seoTitle.length}/70`} value={seoTitle} ref={listen("input", (el) => setSeoTitle(el.value))} />
          <s-text-area
            label="Meta description"
            details={`${seoDescription.length}/320`}
            rows={3}
            value={seoDescription}
            ref={listen("input", (el) => setSeoDescription(el.value))}
          />
          {hintFor("seo")}
          <div>
            {button(
              "seo",
              { seoTitle, seoDescription },
              (seoTitle.trim() !== (data.live.seo.title ?? "") || seoDescription.trim() !== (data.live.seo.description ?? "")) &&
                seoTitle.trim().length <= 70 &&
                seoDescription.trim().length <= 320,
            )}
          </div>
        </s-stack>

        <s-stack gap="small">
          <s-text>Image order (first image shows in collections and search)</s-text>
          {hintFor("images")}
          {mediaIds.length === 0 && <s-text tone="neutral">No images. Add them in Shopify.</s-text>}
          <ol className="m-0 flex list-none flex-wrap gap-3 p-0">
            {mediaIds.map((id, i) => {
              const m = mediaById.get(id);
              return (
                <li key={id} className="flex w-28 flex-col items-center gap-1 rounded border border-zinc-200 p-2">
                  {m?.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.previewUrl} alt={m.alt ?? ""} className="h-20 w-20 object-cover" />
                  ) : (
                    <div className="flex h-20 w-20 items-center justify-center bg-zinc-100 text-xs">{m?.type ?? "Media"}</div>
                  )}
                  <div className="flex gap-1 text-xs">
                    <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="rounded border px-1 disabled:opacity-30" aria-label="Move earlier">
                      ←
                    </button>
                    <span>{i + 1}</span>
                    <button type="button" disabled={i === mediaIds.length - 1} onClick={() => move(i, 1)} className="rounded border px-1 disabled:opacity-30" aria-label="Move later">
                      →
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
          <div>{button("images", { mediaIds }, mediaIds.join() !== data.live.media.map((m) => m.id).join())}</div>
        </s-stack>

        <s-stack gap="small">
          <s-text>Collections</s-text>
          {hintFor("collection")}
          {smart.length > 0 && <s-text tone="neutral">Also in automated collections (by their rules): {smart.map((c) => c.title).join(", ")}.</s-text>}
          <s-text tone="neutral">Undoing a removal adds the product back at the end of a manually sorted collection.</s-text>
          <div className="grid gap-1 sm:grid-cols-2">
            {data.manualCollections.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={collectionIds.includes(c.id)}
                  onChange={(e) => setCollectionIds((ids) => (e.target.checked ? [...ids, c.id] : ids.filter((x) => x !== c.id)))}
                />
                {c.title}
              </label>
            ))}
          </div>
          <div>
            {button(
              "collection",
              { collectionIds },
              [...collectionIds].sort().join() !== data.live.collections.filter((c) => c.manual).map((c) => c.id).sort().join(),
            )}
          </div>
        </s-stack>

        {data.fixes.length > 0 && (
          <s-stack gap="small">
            <s-text>History</s-text>
            <ul className="m-0 list-none space-y-1 p-0 text-sm">
              {data.fixes.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{LABELS[f.type] ?? f.type}</span>
                  <s-badge tone={f.status === "applied" ? "success" : f.status === "failed" ? "critical" : undefined}>{f.status}</s-badge>
                  <span className="text-zinc-500">{new Date(f.appliedAt ?? f.createdAt).toLocaleString()}</span>
                  {f.error && <span className="text-red-700">{f.error}</span>}
                  {(f.status === "applied" || (["approved", "undoing"].includes(f.status) && Date.now() - Date.parse(f.createdAt) > 120_000)) && (
                    <s-button
                      variant="tertiary"
                      disabled={busy !== null || undefined}
                      loading={busy === f.id || undefined}
                      ref={listen("click", () => undo(f.id))}
                    >
                      Undo
                    </s-button>
                  )}
                </li>
              ))}
            </ul>
          </s-stack>
        )}
      </s-stack>
    </s-section>
  );
}
