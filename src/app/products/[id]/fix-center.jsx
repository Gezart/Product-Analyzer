"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiError } from "@/app/api-error";
import { listen } from "@/app/polaris-events";
import { AiPhotos } from "./ai-photos";
import { UpgradeBanner } from "@/app/upgrade-banner";
import { fillInsLeft } from "@/lib/ai-text";

const LABELS = { title: "Title", description: "Description", seo: "SEO", images: "Image order", collection: "Collections" };
const HISTORY_LABELS = { ...LABELS, photo: "Photo added", position: "Collection position" };

/** Edit, apply and undo fixes. Every apply saves the old version first; undo restores it exactly. */
export function FixCenter({ productId, onChanged, onTitle }) {
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
  /** The merchant's text from before "Write with AI", to bring back. */
  const [beforeAi, setBeforeAi] = useState(null);
  // Drafts are filled from the live product the first time it loads (it may not on the first try).
  const hadLive = useRef(false);

  /** Refreshes live data and history; drafts are reset only for the listed types (unsaved edits stay). */
  const load = useCallback(
    async (reset) => {
      const res = await fetch(`/api/products/${productId}/fix-center`);
      if (!res.ok) return setError(res.status === 404 ? "Product not found in Shopify" : (await apiError(res)).message);
      const d = await res.json();
      setData(d);
      onTitle?.(d.title);
      if (!d.live) return;
      if (!hadLive.current) reset = Object.keys(LABELS);
      hadLive.current = true;
      if (reset.includes("title")) setTitle(d.live.title);
      if (reset.includes("description")) setDescription(d.live.descriptionHtml);
      if (reset.includes("seo")) {
        setSeoTitle(d.live.seo.title ?? "");
        setSeoDescription(d.live.seo.description ?? "");
      }
      if (reset.includes("images")) setMediaIds(d.live.media.map((m) => m.id));
      if (reset.includes("collection")) setCollectionIds(d.live.collections.filter((c) => c.manual).map((c) => c.id));
    },
    [productId, onTitle],
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
    if (res.ok && (type === "description" || type === "seo")) setBeforeAi(null);
    if (!res.ok) return setMessage({ tone: "critical", text: body.error ?? `Failed (${res.status})` });
    const note = body.pending ? " Shopify is still finishing it; it can take a minute to show." : "";
    setMessage({ tone: "success", text: `${LABELS[type]} updated in Shopify. The old version is saved; you can undo it below.${note}` });
    onChanged?.();
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
    // Undoing an added photo changes the photo list.
    await load(res.ok && undone ? [undone === "photo" ? "images" : undone] : []);
    if (!res.ok) return setMessage({ tone: "critical", text: body.error ?? `Failed (${res.status})` });
    const note = body.pending ? " Shopify is still finishing it; it can take a minute to show." : "";
    setMessage({ tone: "success", text: `Undone: the product is back to how it was before the fix.${note}` });
    onChanged?.();
  }

  /** "Write with AI": fills the description and SEO drafts; nothing goes to Shopify until Apply. */
  async function writeWithAi() {
    if (busy) return;
    setBusy("ai");
    setMessage(null);
    const res = await fetch(`/api/products/${productId}/ai-description`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setMessage({ tone: "critical", text: body.error ?? `Failed (${res.status})` });
    setBeforeAi((b) => b ?? { description, seoTitle, seoDescription }); // a second draft keeps the merchant's own text
    setDescription(body.draft.descriptionHtml);
    setSeoTitle(body.draft.seoTitle);
    setSeoDescription(body.draft.seoDescription);
    setData((d) => ({ ...d, ai: { ...d.ai, descriptions: { ...d.ai.descriptions, ...body.ai } } }));
    setMessage({
      tone: "info",
      text: body.draft.fillIn.length
        ? `Draft written by AI. Fill in ${body.draft.fillIn.join(", ")} where it says [fill in: …], check the rest, then apply the description and the SEO.`
        : "Draft written by AI. Check it, then apply the description and the SEO.",
    });
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
  const smart = data.live?.collections.filter((c) => !c.manual) ?? [];
  const mediaById = new Map((data.live?.media ?? []).map((m) => [m.id, m]));
  const hintFor = (type) => data.hints.filter((h) => h.type === type).map((h) => <s-text key={h.code} tone="neutral">💡 {h.hint}</s-text>);
  // AI drafts leave [fill in: …] for facts only the merchant knows: nothing applies until they're gone.
  const descriptionFillIns = fillInsLeft(description);
  const seoFillIns = fillInsLeft(seoTitle, seoDescription);
  /** A photo went to Shopify: the photo list is read again (the merchant's reorder draft is reset). */
  async function photoAdded(text) {
    await load(["images"]);
    setMessage({ tone: "success", text });
    onChanged?.();
  }

  function restoreText() {
    setDescription(beforeAi.description);
    setSeoTitle(beforeAi.seoTitle);
    setSeoDescription(beforeAi.seoDescription);
    setBeforeAi(null);
    setMessage(null);
  }

  const fillInNote = (left) => left.length > 0 && <s-text tone="caution">Fill in {left.join(", ")} first (where it says [fill in: …]).</s-text>;
  const ai = data.ai?.descriptions;
  const weakDescription = ["short_description", "missing_details", "duplicate_description"].some((c) => data.reasonCodes?.includes(c));

  return (
    <s-section heading="Fix center">
      <s-stack gap="base">
        {data.upgrade && <UpgradeBanner>{data.upgrade.reason}</UpgradeBanner>}
        {/* Hints the page editors below can't act on (e.g. returns: supplier, fulfillment, carrier). */}
        {hintFor("other")}
        {data.liveError && (
          <s-banner tone="warning">
            {data.liveError} Editing needs the live product{data.fixes.length > 0 ? "; your fix history and undo are below" : ""}.
          </s-banner>
        )}
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

        {data.live && (
          <>
            <s-stack gap="small" id="title">
              <s-text-field label="Title" value={title} ref={listen("input", (el) => setTitle(el.value))} />
              {hintFor("title")}
              <div>{button("title", { title }, title.trim() !== data.live.title && title.trim().length > 0 && title.trim().length <= 255)}</div>
            </s-stack>

            <s-stack gap="small" id="description">
              <s-text-area label="Description (HTML)" rows={8} value={description} ref={listen("input", (el) => setDescription(el.value))} />
              {hintFor("description")}
              {ai?.upgrade && <s-text tone="neutral">Writing the description with AI is included from the Starter plan.</s-text>}
              {ai && !ai.upgrade && !ai.configured && <s-text tone="neutral">Writing with AI isn't set up for this app yet.</s-text>}
              {ai && !ai.upgrade && ai.configured && (
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-button
                    variant={weakDescription ? "primary" : "secondary"}
                    disabled={busy !== null || ai.left === 0 || undefined}
                    loading={busy === "ai" || undefined}
                    ref={listen("click", writeWithAi)}
                  >
                    Write with AI
                  </s-button>
                  <s-text tone="neutral">
                    {ai.left} of {ai.limit} AI drafts left this month{ai.left === 0 ? " (they renew on the 1st)" : ""}
                  </s-text>
                  {beforeAi && (
                    <s-button variant="tertiary" disabled={busy !== null || undefined} ref={listen("click", restoreText)}>
                      Back to my text
                    </s-button>
                  )}
                </s-stack>
              )}
              {fillInNote(descriptionFillIns)}
              <div>{button("description", { descriptionHtml: description }, description !== data.live.descriptionHtml && descriptionFillIns.length === 0)}</div>
            </s-stack>

            <s-stack gap="small" id="seo">
              <s-text-field label="SEO title" details={`${seoTitle.length}/70`} value={seoTitle} ref={listen("input", (el) => setSeoTitle(el.value))} />
              <s-text-area
                label="Meta description"
                details={`${seoDescription.length}/320`}
                rows={3}
                value={seoDescription}
                ref={listen("input", (el) => setSeoDescription(el.value))}
              />
              {hintFor("seo")}
              {fillInNote(seoFillIns)}
              <div>
                {button(
                  "seo",
                  { seoTitle, seoDescription },
                  (seoTitle.trim() !== (data.live.seo.title ?? "") || seoDescription.trim() !== (data.live.seo.description ?? "")) &&
                    seoTitle.trim().length <= 70 &&
                    seoDescription.trim().length <= 320 &&
                    seoFillIns.length === 0,
                )}
              </div>
            </s-stack>

            <s-stack gap="small" id="photos">
              <s-text>Image order (first image shows in collections and search)</s-text>
              {hintFor("images")}
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
                      {data.aiMediaIds?.includes(id) && <s-badge>AI-made</s-badge>}
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
              {mediaIds.length > 0 && <div>{button("images", { mediaIds }, mediaIds.join() !== data.live.media.map((m) => m.id).join())}</div>}
              <AiPhotos
                productId={productId}
                media={data.live.media}
                ai={data.ai?.photos}
                primary={data.reasonCodes?.includes("few_images")}
                diagnosisId={data.diagnosisId}
                locked={data.upgrade != null}
                busy={busy}
                setBusy={setBusy}
                setMessage={setMessage}
                onAdded={photoAdded}
              />
            </s-stack>

            <s-stack gap="small" id="collections">
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
          </>
        )}

        {data.fixes.length > 0 && (
          <s-stack gap="small">
            <s-text>History</s-text>
            <ul className="m-0 list-none space-y-1 p-0 text-sm">
              {data.fixes.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{HISTORY_LABELS[f.type] ?? f.type}</span>
                  <s-badge tone={f.status === "applied" ? "success" : f.status === "failed" ? "critical" : undefined}>{f.status}</s-badge>
                  <span className="text-zinc-500">{new Date(f.appliedAt ?? f.createdAt).toLocaleString()}</span>
                  {f.error && <span className="text-red-700">{f.error}</span>}
                  {f.type === "position" && f.status === "applied" && f.collectionId && (
                    <Link href={`/collections?c=${f.collectionId}`} className="text-sm underline">
                      Undo on the Collections page
                    </Link>
                  )}
                  {f.type !== "position" && (f.status === "applied" || (["approved", "undoing"].includes(f.status) && Date.now() - Date.parse(f.createdAt) > 120_000)) && (
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
