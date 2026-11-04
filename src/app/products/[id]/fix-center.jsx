"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiError } from "@/app/api-error";
import { BTN, CARD, H2, Notice, PageHeader } from "@/app/ui/kit";
import { useHashScroll } from "@/app/ui/use-hash-scroll";
import { applyBlocker, changedTypes, checklist, wordCount } from "@/lib/fix-page";
import { AiPhotoMaker, PhotoUpload } from "./ai-photos";
import { DescriptionPreview } from "./description-preview";

const LABELS = { title: "Title", description: "Description", seo: "SEO", images: "Photo order", collection: "Collections" };
const HISTORY_LABELS = { ...LABELS, photo: "Photo added", position: "Collection position" };
const STATUS_NOTES = { failed: "failed", undone: "undone", approved: "in progress", undoing: "undoing", cancelled: "cancelled" };
const INPUT = "w-full rounded-lg border border-line-strong bg-white px-[11px] py-[9px] font-[inherit]";
const TOGGLE = (on) =>
  `cursor-pointer rounded-[7px] border px-2.5 py-[5px] font-[inherit] text-[13px] font-semibold ${on ? "border-ink bg-ink text-white" : "border-line-strong bg-white text-ink"}`;
const day = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/**
 * The Fix center (the owner's design): the description (with an AI draft), photos (with AI), title and
 * SEO, collections; the diagnosis's checklist and the history beside them; one bar applies every change.
 * Each applied change saves the old version first, and undo restores it exactly.
 */
export function FixCenter({ productId }) {
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
  // "Write with AI": the AI's draft and the merchant's own text from before it, to switch between.
  const [aiDraft, setAiDraft] = useState(null);
  const [mine, setMine] = useState(null);
  const [version, setVersion] = useState("current");
  const [editing, setEditing] = useState(false);
  // Photos made with AI, waiting to be picked: `{ id, image, label, picked }`.
  const [photoDrafts, setPhotoDrafts] = useState([]);
  const [makerOpen, setMakerOpen] = useState(false);
  const [allCollections, setAllCollections] = useState(false);
  // Drafts are filled from the live product the first time it loads (it may not on the first try).
  const hadLive = useRef(false);

  /** Refreshes live data and history; drafts are reset only for the listed types (unsaved edits stay). */
  const load = useCallback(
    async (reset) => {
      const res = await fetch(`/api/products/${productId}/fix-center`);
      if (!res.ok) return setError(res.status === 404 ? "Product not found in Shopify" : (await apiError(res)).message);
      const d = await res.json();
      setData(d);
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
    [productId],
  );

  useEffect(() => {
    load(Object.keys(LABELS));
  }, [load]);

  // A diagnosis button names its section (e.g. #description): scroll there once it has loaded.
  useHashScroll(Boolean(data));

  const back = { href: `/products/${productId}`, label: data?.title ?? "Product" };
  const header = (actions) => (
    <PageHeader back={back} title={data?.title ? `Fix center · ${data.title}` : "Fix center"} subtitle="Changes go straight to Shopify. Every change can be undone." actions={actions} />
  );
  if (error) return <>{header()}<Notice tone="bad">{error}</Notice></>;
  if (!data) return <>{header()}<p className="m-0 text-muted">Loading the fix center…</p></>;

  const live = data.live;
  const drafts = { title, description, seoTitle, seoDescription, mediaIds, collectionIds };
  const types = changedTypes(live, drafts);
  const picked = photoDrafts.filter((p) => p.picked);
  const changes = types.length + picked.length;
  const blocker = applyBlocker(types, drafts);
  const locked = data.upgrade != null;
  const ai = data.ai?.descriptions;
  const aiPhotos = data.ai?.photos;
  const reasonCodes = data.reasonCodes ?? [];
  const items = checklist(data.reasons ?? [], { ...drafts, photoCount: mediaIds.length + picked.length }, live);

  /** The state this page shows, so the server can refuse if Shopify changed meanwhile. */
  function loadedState(type) {
    switch (type) {
      case "title": return { title: live.title };
      case "description": return { descriptionHtml: live.descriptionHtml };
      case "seo": return { seoTitle: live.seo.title ?? "", seoDescription: live.seo.description ?? "" };
      case "images": return { mediaIds: live.media.map((m) => m.id) };
      default: return { collectionIds: live.collections.filter((c) => c.manual).map((c) => c.id).sort() };
    }
  }
  const afterOf = {
    title: () => ({ title }),
    description: () => ({ descriptionHtml: description }),
    seo: () => ({ seoTitle, seoDescription }),
    images: () => ({ mediaIds }),
    collection: () => ({ collectionIds }),
  };

  /** Applies every changed draft in turn, then the picked AI photos; stops at the first failure. */
  async function applyAll() {
    if (busy || changes === 0 || blocker) return;
    setBusy("apply");
    setMessage(null);
    const appliedTypes = [];
    let failure = null;
    let pending = false;
    for (const type of types) {
      const res = await fetch(`/api/products/${productId}/fixes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, after: afterOf[type](), expected: loadedState(type), diagnosisId: data.diagnosisId }),
      }).catch(() => null);
      const body = res ? await res.json().catch(() => ({})) : {};
      if (!res?.ok) {
        failure = `${LABELS[type]}: ${body.error ?? `failed (${res?.status ?? "network"})`}`;
        break;
      }
      appliedTypes.push(type);
      pending ||= Boolean(body.pending);
    }
    const added = [];
    if (!failure) {
      for (const photo of picked) {
        const res = await fetch(`/api/ai-photos/${photo.id}/add`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ diagnosisId: data.diagnosisId }),
        }).catch(() => null);
        const body = res ? await res.json().catch(() => ({})) : {};
        if (!res?.ok) {
          failure = `AI photo: ${body.error ?? `failed (${res?.status ?? "network"})`}`;
          break;
        }
        added.push(photo.id);
      }
    }
    setPhotoDrafts((list) => list.filter((p) => !added.includes(p.id)));
    // Only what went to Shopify is read again; the other drafts keep the merchant's edits.
    await load(added.length ? [...appliedTypes, "images"] : appliedTypes);
    if (appliedTypes.includes("description") || appliedTypes.includes("seo")) {
      setAiDraft(null);
      setMine(null);
      setVersion("current");
    }
    setBusy(null);
    const applied = [...appliedTypes.map((t) => LABELS[t]), ...(added.length ? [`${added.length} AI photo${added.length === 1 ? "" : "s"}`] : [])];
    const done = applied.length ? `Applied to Shopify: ${applied.join(", ")}. The old versions are saved; you can undo them in the history.` : "";
    const note = pending ? " Shopify is still finishing a change; it can take a minute to show." : "";
    setMessage(failure ? { tone: "bad", text: `${done} Not applied: ${failure}`.trim() } : { tone: "good", text: done + note });
  }

  async function undo(fixId, force = false) {
    if (busy) return;
    setBusy(fixId);
    setMessage(null);
    const res = await fetch(`/api/fixes/${fixId}/undo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    setBusy(null);
    if (res?.status === 409 && !force && /changed since/.test(body.error ?? "")) {
      return setMessage({ tone: "bad", text: body.error, forceFix: fixId });
    }
    const undone = data.fixes.find((f) => f.id === fixId)?.type;
    // Undoing an added photo changes the photo list.
    await load(res?.ok && undone ? [undone === "photo" ? "images" : undone] : []);
    if (!res?.ok) return setMessage({ tone: "bad", text: body.error ?? `Failed (${res?.status ?? "network"})` });
    const note = body.pending ? " Shopify is still finishing it; it can take a minute to show." : "";
    setMessage({ tone: "good", text: `Undone: the product is back to how it was before the fix.${note}` });
  }

  /** "Write with AI": fills the description and SEO drafts; nothing goes to Shopify until Apply. */
  async function writeWithAi() {
    if (busy) return;
    setBusy("ai");
    setMessage(null);
    const res = await fetch(`/api/products/${productId}/ai-description`, { method: "POST" }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    setBusy(null);
    if (!res?.ok) return setMessage({ tone: "bad", text: body.error ?? `Failed (${res?.status ?? "network"})` });
    // A second draft keeps the merchant's own text from before the first.
    if (!mine || version === "current") setMine({ description, seoTitle, seoDescription });
    const draft = { description: body.draft.descriptionHtml, seoTitle: body.draft.seoTitle, seoDescription: body.draft.seoDescription };
    setAiDraft(draft);
    setVersion("ai");
    setEditing(false);
    setDescription(draft.description);
    setSeoTitle(draft.seoTitle);
    setSeoDescription(draft.seoDescription);
    setData((d) => ({ ...d, ai: { ...d.ai, descriptions: { ...d.ai.descriptions, ...body.ai } } }));
  }

  /** Switches between the merchant's text and the AI draft, keeping edits to either. */
  function switchVersion(next) {
    if (next === version || !aiDraft || !mine) return;
    const now = { description, seoTitle, seoDescription };
    if (version === "ai") setAiDraft(now);
    else setMine(now);
    const target = next === "ai" ? aiDraft : mine;
    setDescription(target.description);
    setSeoTitle(target.seoTitle);
    setSeoDescription(target.seoDescription);
    setVersion(next);
  }

  /** Back to the live product: every draft and pick is dropped (AI photos stay in the suggestions). */
  function discard() {
    setTitle(live.title);
    setDescription(live.descriptionHtml);
    setSeoTitle(live.seo.title ?? "");
    setSeoDescription(live.seo.description ?? "");
    setMediaIds(live.media.map((m) => m.id));
    setCollectionIds(live.collections.filter((c) => c.manual).map((c) => c.id));
    setPhotoDrafts((list) => list.map((p) => ({ ...p, picked: false })));
    setAiDraft(null);
    setMine(null);
    setVersion("current");
    setEditing(false);
    setMessage(null);
  }

  async function removePhotoDraft(id) {
    setPhotoDrafts((list) => list.filter((p) => p.id !== id));
    await fetch(`/api/ai-photos/${id}`, { method: "DELETE" }).catch(() => {});
  }

  async function photoUploaded(text) {
    await load(["images"]);
    setMessage({ tone: "good", text });
  }

  const move = (i, delta) => {
    const next = [...mediaIds];
    const [item] = next.splice(i, 1);
    next.splice(i + delta, 0, item);
    setMediaIds(next);
  };

  // "AI this month: 18 of 30 drafts · 9 of 20 photos" for what this store's plan includes.
  const usage = [
    ai && !ai.upgrade && ai.configured && `${ai.limit - ai.left} of ${ai.limit} drafts`,
    aiPhotos && !aiPhotos.upgrade && aiPhotos.configured && `${aiPhotos.limit - aiPhotos.left} of ${aiPhotos.limit} photos`,
  ].filter(Boolean);
  const usagePill = usage.length > 0 && (
    <span className="rounded-full border border-line bg-white px-3 py-[5px] text-[13px] text-ink-2">AI this month: {usage.join(" · ")}</span>
  );

  const media = live ? mediaIds.map((id) => live.media.find((m) => m.id === id)).filter(Boolean) : [];
  const photos = live ? live.media.filter((m) => m.type === "IMAGE" && m.previewUrl) : [];
  const fewImages = data.reasons?.find((r) => r.code === "few_images");
  const weakDescription = ["short_description", "missing_details", "duplicate_description"].some((c) => reasonCodes.includes(c));
  const aiFillIns = version === "ai" ? (description.match(/\[\s*fill[\s-]*in\b/gi) ?? []).length : 0;
  const smart = live?.collections.filter((c) => !c.manual) ?? [];
  const selected = new Set(collectionIds);
  const others = data.manualCollections.filter((c) => !selected.has(c.id));
  const shownOthers = allCollections ? others : others.slice(0, 8);
  const titleOf = new Map([...(live?.collections ?? []).map((c) => [c.id, c.title]), ...data.manualCollections.map((c) => [c.id, c.title])]);
  const aiReady = (x) => x && !x.upgrade && x.configured;

  return (
    <>
      {header(usagePill)}
      {data.upgrade && (
        <Notice tone="warn" className="px-4 py-3 text-[13px]">
          {data.upgrade.reason}{" "}
          <Link href="/plans" className="font-semibold text-[#92400E] underline">
            See plans
          </Link>
        </Notice>
      )}
      {data.liveError && (
        <Notice tone="warn" className="px-4 py-3 text-[13px]">
          {data.liveError} Editing needs the live product{data.fixes.length > 0 ? "; your fix history and undo are beside it" : ""}.
        </Notice>
      )}
      {message && (
        <Notice tone={message.tone} className="px-4 py-3 text-[13px]">
          {message.text}{" "}
          {message.forceFix && (
            <button type="button" disabled={busy !== null} onClick={() => undo(message.forceFix, true)} className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] font-semibold underline">
              Undo anyway
            </button>
          )}
        </Notice>
      )}

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-4">
          {live && (
            <>
              <section id="description" aria-labelledby="desc" className={`${CARD} flex scroll-mt-4 flex-col gap-3 px-5 py-[18px]`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 id="desc" className={H2}>
                    Description{!(aiDraft && mine) && ` · ${wordCount(description)} words`}
                  </h2>
                  {aiDraft && mine && (
                    <div role="group" aria-label="Version" className="flex gap-1">
                      <button type="button" aria-pressed={version === "current"} onClick={() => switchVersion("current")} className={TOGGLE(version === "current")}>
                        Current · {wordCount(version === "current" ? description : mine.description)} words
                      </button>
                      <button type="button" aria-pressed={version === "ai"} onClick={() => switchVersion("ai")} className={TOGGLE(version === "ai")}>
                        AI draft · {wordCount(version === "ai" ? description : aiDraft.description)} words
                      </button>
                    </div>
                  )}
                </div>
                {editing ? (
                  <>
                    <label htmlFor="description-html" className="sr-only">
                      Description (HTML)
                    </label>
                    <textarea id="description-html" rows={10} value={description} onChange={(e) => setDescription(e.target.value)} className={`${INPUT} font-mono text-[13px] leading-[1.5]`} />
                  </>
                ) : (
                  <DescriptionPreview html={description} />
                )}
                {version === "ai" && (
                  <p className="m-0 text-[13px] text-muted">
                    Written from your title, variants, photos and current text, in your store&apos;s language. The AI never guesses facts
                    {aiFillIns > 0 ? `: fill in the ${aiFillIns} highlighted part${aiFillIns === 1 ? "" : "s"} before applying.` : "."}
                  </p>
                )}
                {ai?.upgrade && (
                  <p className="m-0 text-[13px] text-muted">
                    Writing the description with AI is included from the Starter plan. <Link href="/plans">See plans</Link>
                  </p>
                )}
                {ai && !ai.upgrade && !ai.configured && <p className="m-0 text-[13px] text-muted">Writing with AI isn&apos;t set up for this app yet.</p>}
                <div className="flex flex-wrap items-center gap-2">
                  {aiReady(ai) && (
                    <button
                      type="button"
                      disabled={busy !== null || ai.left === 0 || locked}
                      onClick={writeWithAi}
                      className={`${weakDescription && !aiDraft ? BTN.primary : BTN.secondary} cursor-pointer`}
                    >
                      {busy === "ai" ? "Writing…" : aiDraft ? "Write again" : "Write with AI"}
                    </button>
                  )}
                  <button type="button" onClick={() => setEditing((e) => !e)} className={`${BTN.secondary} cursor-pointer`}>
                    {editing ? "Preview" : version === "ai" ? "Edit draft" : "Edit text"}
                  </button>
                  {aiReady(ai) && (
                    <span className="text-[13px] text-muted">
                      {ai.left} of {ai.limit} AI drafts left this month{ai.left === 0 ? " (they renew on the 1st)" : ""}
                    </span>
                  )}
                </div>
              </section>

              <section id="photos" aria-labelledby="photos-h" className={`${CARD} flex scroll-mt-4 flex-col gap-3 px-5 py-[18px]`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 id="photos-h" className={H2}>
                    Photos · {media.length} now{fewImages ? `, ${fewImages.data?.minimum ?? 3} recommended` : ""}
                  </h2>
                  {photos.length > 0 && aiReady(aiPhotos) && (
                    <button type="button" aria-expanded={makerOpen} onClick={() => setMakerOpen((o) => !o)} className={`${BTN.small} cursor-pointer`}>
                      {makerOpen ? "Close" : "Create more with AI"}
                    </button>
                  )}
                </div>
                {photos.length === 0 && <PhotoUpload productId={productId} locked={locked} busy={busy} setBusy={setBusy} setMessage={setMessage} onAdded={photoUploaded} />}
                {media.length > 0 && (
                  <>
                    <p className="m-0 text-[13px] font-semibold">Current · the first photo shows in collections and search</p>
                    <ol className="m-0 flex list-none flex-wrap gap-2.5 p-0">
                      {media.map((m, i) => (
                        <li key={m.id} className="flex w-24 flex-col items-center gap-1">
                          <div className="relative h-[120px] w-24 overflow-hidden rounded-lg bg-[#E9EBEF]">
                            {m.previewUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={m.previewUrl} alt={m.alt ?? ""} className="h-full w-full object-cover" />
                            ) : (
                              <span className="grid h-full w-full place-items-center text-xs text-muted">{m.type === "VIDEO" ? "Video" : "Media"}</span>
                            )}
                            {data.aiMediaIds?.includes(m.id) && <span className="absolute bottom-1.5 left-1.5 rounded bg-white/90 px-1.5 py-px text-[11px] font-semibold">AI</span>}
                          </div>
                          <div className="flex items-center gap-1 text-xs">
                            <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move earlier" className="cursor-pointer rounded border border-line-strong bg-white px-1.5 disabled:cursor-default disabled:opacity-30">
                              ←
                            </button>
                            <span className="w-4 text-center tabular-nums">{i + 1}</span>
                            <button type="button" disabled={i === media.length - 1} onClick={() => move(i, 1)} aria-label="Move later" className="cursor-pointer rounded border border-line-strong bg-white px-1.5 disabled:cursor-default disabled:opacity-30">
                              →
                            </button>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </>
                )}
                {photos.length > 0 && aiPhotos?.upgrade && (
                  <p className="m-0 text-[13px] text-muted">
                    Making photos with AI is included from the Growth plan. <Link href="/plans">See plans</Link>
                  </p>
                )}
                {photos.length > 0 && aiPhotos && !aiPhotos.upgrade && !aiPhotos.configured && <p className="m-0 text-[13px] text-muted">Photos with AI aren&apos;t set up for this app yet.</p>}
                {makerOpen && photos.length > 0 && aiReady(aiPhotos) && (
                  <AiPhotoMaker
                    productId={productId}
                    photos={photos}
                    ai={aiPhotos}
                    primary={reasonCodes.includes("few_images")}
                    locked={locked}
                    busy={busy}
                    setBusy={setBusy}
                    setMessage={setMessage}
                    onCreated={(draft, usageNow) => {
                      setPhotoDrafts((list) => [...list, { ...draft, picked: true }]);
                      setData((d) => ({ ...d, ai: { ...d.ai, photos: { ...d.ai.photos, ...usageNow } } }));
                    }}
                  />
                )}
                {photoDrafts.length > 0 && (
                  <>
                    <p className="mt-1 mb-0 text-[13px] font-semibold">AI suggestions · pick the ones to add</p>
                    <ul className="m-0 grid list-none grid-cols-2 gap-2.5 p-0 sm:grid-cols-4">
                      {photoDrafts.map((p) => (
                        <li key={p.id} className="flex min-w-0 flex-col gap-1.5">
                          <div className="relative aspect-[4/5] overflow-hidden rounded-lg border border-line bg-head">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={p.image} alt={`Photo made with AI: ${p.label}`} className="h-full w-full object-cover" />
                            <span className="absolute bottom-1.5 left-1.5 rounded bg-white/90 px-1.5 py-px text-[11px] font-semibold">AI</span>
                          </div>
                          <label className="flex min-w-0 items-center gap-1.5 text-[13px]">
                            <input type="checkbox" checked={p.picked} onChange={(e) => setPhotoDrafts((list) => list.map((x) => (x.id === p.id ? { ...x, picked: e.target.checked } : x)))} />
                            <span className="min-w-0 truncate">{p.label}</span>
                          </label>
                          <button type="button" onClick={() => removePhotoDraft(p.id)} className="cursor-pointer self-start border-0 bg-transparent p-0 font-[inherit] text-xs font-semibold text-muted hover:text-ink">
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                    <p className="m-0 text-[13px] text-muted">Check that the product looks exactly like the real one. Picked photos are added after the others when you apply.</p>
                  </>
                )}
                <p className="m-0 text-[13px] text-muted">Made from your real photo, so the product stays the same. An AI photo&apos;s alt text says it&apos;s AI-made. A product with no photo needs one real photo first.</p>
              </section>

              <section id="seo" aria-labelledby="seo-h" className={`${CARD} flex scroll-mt-4 flex-col gap-3 px-5 py-[18px]`}>
                <h2 id="seo-h" className={H2}>
                  Title and SEO
                </h2>
                <Field id="title" label="Title" value={title} onChange={setTitle} hint={title.trim() !== live.title ? `Was: "${live.title}".` : `${title.length} of 255 characters`} />
                <Field
                  id="seo-title"
                  label="SEO title"
                  value={seoTitle}
                  onChange={setSeoTitle}
                  hint={`${live.seo.title ? "" : "Missing until now · "}${seoTitle.trim().length} of 70 characters`}
                  bad={seoTitle.trim().length > 70}
                />
                <Field
                  id="seo-description"
                  label="Meta description"
                  value={seoDescription}
                  onChange={setSeoDescription}
                  hint={`${live.seo.description ? "" : "Missing until now · "}${seoDescription.trim().length} of 320 characters`}
                  bad={seoDescription.trim().length > 320}
                  rows={3}
                />
              </section>

              <section id="collections" aria-labelledby="coll" className={`${CARD} flex scroll-mt-4 flex-col gap-2.5 px-5 py-[18px]`}>
                <h2 id="coll" className={H2}>
                  Collections
                </h2>
                <div className="flex flex-wrap items-center gap-1.5">
                  {collectionIds.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setCollectionIds((ids) => ids.filter((x) => x !== id))}
                      aria-label={`Remove from ${titleOf.get(id) ?? "collection"}`}
                      className="cursor-pointer rounded-full border-0 bg-canvas px-2.5 py-[5px] font-[inherit] text-[13px] font-semibold text-ink"
                    >
                      {titleOf.get(id) ?? "Collection"} ✕
                    </button>
                  ))}
                  {smart.map((c) => (
                    <span key={c.id} className="rounded-full bg-head px-2.5 py-[5px] text-[13px] text-muted" title="Automated collection: set by its rules">
                      {c.title}
                    </span>
                  ))}
                  {shownOthers.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setCollectionIds((ids) => [...ids, c.id])}
                      className="cursor-pointer rounded-full border border-dashed border-accent bg-white px-2.5 py-[5px] font-[inherit] text-[13px] font-semibold text-accent"
                    >
                      + {c.title}
                    </button>
                  ))}
                  {others.length > 8 && (
                    <button type="button" onClick={() => setAllCollections((a) => !a)} className="cursor-pointer border-0 bg-transparent px-1 font-[inherit] text-[13px] font-semibold text-accent">
                      {allCollections ? "Show fewer" : `Show all ${others.length}`}
                    </button>
                  )}
                </div>
                {collectionIds.length === 0 && smart.length === 0 && <p className="m-0 text-[13px] text-[#92400E]">Not in any collection yet, so shoppers can&apos;t browse to it.</p>}
                <p className="m-0 text-xs text-muted">
                  {smart.length > 0 && "Grey ones are automated collections, set by their rules. "}Undoing a removal adds the product back at the end of a manually sorted collection.
                </p>
              </section>
            </>
          )}
        </div>

        <aside className="flex min-w-0 flex-[1_1_280px] flex-col gap-4">
          <section aria-labelledby="todo" className={`${CARD} flex flex-col gap-1.5 px-[18px] py-4`}>
            <h2 id="todo" className={`${H2} mb-1`}>
              From the diagnosis
            </h2>
            {items.length === 0 && <p className="m-0 text-[13px] text-muted">Nothing found on this product&apos;s page. Its diagnosis is on the product page.</p>}
            {items.map((t) => {
              const hint = data.hints.find((h) => h.code === t.code)?.hint;
              return (
                <div key={t.code} className="flex items-start gap-2 text-[13px]">
                  <span aria-hidden="true" className={`mt-0.5 grid h-4 w-4 flex-none place-items-center rounded text-[11px] text-white ${t.done ? "bg-[#059669]" : "bg-line-strong"}`}>
                    {t.done ? "✓" : ""}
                  </span>
                  <span className="min-w-0">
                    <span className="sr-only">{t.done ? "Done: " : "To do: "}</span>
                    {t.text}
                    {hint && !t.done && <span className="block text-xs text-muted">{hint}</span>}
                  </span>
                </div>
              );
            })}
          </section>
          <section aria-labelledby="hist" className={`${CARD} flex flex-col gap-2 px-[18px] py-4`}>
            <h2 id="hist" className={H2}>
              History
            </h2>
            {data.fixes.length === 0 && <p className="m-0 text-[13px] text-muted">No changes yet. Each change you apply shows here and can be undone.</p>}
            {data.fixes.map((f) => {
              const canUndo = f.type !== "position" && (f.status === "applied" || (["approved", "undoing"].includes(f.status) && Date.now() - Date.parse(f.createdAt) > 120_000));
              return (
                <div key={f.id} className="flex items-center gap-2 border-t border-hair pt-2 text-[13px]">
                  <span className="min-w-0 flex-1">
                    <strong>{HISTORY_LABELS[f.type] ?? f.type}</strong>
                    <br />
                    <span className="text-muted">
                      {day(f.appliedAt ?? f.createdAt)}
                      {STATUS_NOTES[f.status] ? ` · ${STATUS_NOTES[f.status]}` : ""}
                    </span>
                    {f.error && <span className="block text-xs text-[#B91C1C]">{f.error}</span>}
                  </span>
                  {f.type === "position" && f.status === "applied" && f.collectionId && (
                    <Link href={`/collections?c=${f.collectionId}`} className={BTN.tiny}>
                      Undo in Collections
                    </Link>
                  )}
                  {canUndo && (
                    <button type="button" disabled={busy !== null} onClick={() => undo(f.id)} className={`${BTN.tiny} cursor-pointer`}>
                      {busy === f.id ? "Undoing…" : "Undo"}
                    </button>
                  )}
                </div>
              );
            })}
          </section>
        </aside>
      </div>

      {live && (
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-line bg-white px-4 py-3 shadow-[0_-2px_10px_rgba(26,26,26,0.06)]">
          <p className="m-0 text-[13px] text-ink-2">
            {changes === 0 ? (
              "No changes yet."
            ) : (
              <>
                <strong>
                  {changes} change{changes === 1 ? "" : "s"} ready.
                </strong>{" "}
                {blocker ?? "A rescue plan starts when you apply and measures 14–30 days."}
              </>
            )}
          </p>
          <div className="flex gap-2">
            <button type="button" disabled={changes === 0 || busy !== null} onClick={discard} className={`${BTN.secondary} cursor-pointer`}>
              Discard
            </button>
            <button type="button" disabled={changes === 0 || blocker != null || busy !== null || locked} onClick={applyAll} className={`${BTN.primary} cursor-pointer`}>
              {busy === "apply" ? "Applying…" : "Apply to Shopify"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function Field({ id, label, value, onChange, hint, bad = false, rows }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[13px] font-semibold">
        {label}
      </label>
      {rows ? (
        <textarea id={id} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} className={INPUT} />
      ) : (
        <input id={id} type="text" value={value} onChange={(e) => onChange(e.target.value)} className={INPUT} />
      )}
      <span className={`text-xs ${bad ? "text-[#B91C1C]" : "text-muted"}`}>{hint}</span>
    </div>
  );
}
