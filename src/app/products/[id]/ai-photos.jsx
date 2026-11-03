"use client";

import { useState } from "react";
import { listen } from "@/app/polaris-events";
import { MAX_SCENE_LENGTH } from "@/lib/ai-photo";

const NO_PHOTO = "This product has no photo yet. Add one first: the AI starts from a real photo of the product.";

/**
 * "Create photo with AI" in the fix center's photo section: pick one of the product's photos and a
 * white background or a scene; the AI's photo is shown first and only goes to Shopify when the merchant
 * adds it (undoable from the history). A product without a photo asks for one to be uploaded.
 */
export function AiPhotos({ productId, media, ai, primary, diagnosisId, locked, busy, setBusy, setMessage, onAdded }) {
  const photos = media.filter((m) => m.type === "IMAGE" && m.previewUrl);
  const [sourceId, setSourceId] = useState(null);
  const [style, setStyle] = useState("white");
  const [scene, setScene] = useState("");
  const [draft, setDraft] = useState(null);
  const [left, setLeft] = useState(null);
  const source = photos.find((m) => m.id === sourceId) ?? photos[0];
  const remaining = left ?? ai?.left;

  async function call(kind, url, init) {
    if (busy) return null;
    setBusy(kind);
    setMessage(null);
    const res = await fetch(url, init).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    setBusy(null);
    if (!res?.ok) {
      setMessage({ tone: "critical", text: body.error ?? `Failed (${res?.status ?? "network"})` });
      return null;
    }
    return body;
  }

  async function create() {
    const body = await call("ai-photo", `/api/products/${productId}/ai-photo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mediaId: source.id, style, scene: style === "scene" ? scene : undefined }),
    });
    if (!body) return;
    setDraft(body.draft);
    setLeft(body.ai.left);
  }

  async function add() {
    const body = await call("ai-photo-add", `/api/ai-photos/${draft.id}/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ diagnosisId }),
    });
    if (!body) return;
    setDraft(null);
    await onAdded("AI photo added to the product in Shopify, after its other photos. Its alt text says it's AI-made; you can undo it below.");
  }

  async function discard() {
    const id = draft.id;
    setDraft(null);
    await fetch(`/api/ai-photos/${id}`, { method: "DELETE" }).catch(() => {});
  }

  async function upload(input) {
    const file = input.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const body = await call("photo-upload", `/api/products/${productId}/photo`, { method: "POST", body: form });
    input.value = "";
    if (body) await onAdded("Photo added to the product in Shopify. Shopify may take a moment to process it; you can undo it below.");
  }

  if (!photos.length) {
    return (
      <s-stack gap="small">
        <s-text tone="caution">{NO_PHOTO}</s-text>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span>Upload a photo (JPEG, PNG or WebP, up to 20 MB):</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={locked || busy !== null}
            onChange={(e) => upload(e.target)}
          />
        </label>
        {busy === "photo-upload" && <s-text tone="neutral">Uploading…</s-text>}
      </s-stack>
    );
  }
  if (!ai) return null;
  if (ai.upgrade) return <s-text tone="neutral">Making photos with AI is included from the Growth plan.</s-text>;
  if (!ai.configured) return <s-text tone="neutral">Photos with AI aren&apos;t set up for this app yet.</s-text>;

  if (draft) {
    return (
      <s-stack gap="small">
        <s-text>Photo made with AI. Check that the product looks exactly like the real one before adding it.</s-text>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={draft.image} alt="Photo made with AI (preview)" className="max-h-80 w-auto max-w-full self-start rounded border border-zinc-200" />
        <s-stack direction="inline" gap="small">
          <s-button variant="primary" disabled={locked || busy !== null || undefined} loading={busy === "ai-photo-add" || undefined} ref={listen("click", add)}>
            Add to product
          </s-button>
          <s-button variant="secondary" disabled={busy !== null || undefined} ref={listen("click", discard)}>
            Discard
          </s-button>
        </s-stack>
      </s-stack>
    );
  }

  return (
    <s-stack gap="small">
      <s-text>Create a photo with AI from one of the product&apos;s photos</s-text>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Photo to start from">
        {photos.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={m.id === source.id}
            onClick={() => setSourceId(m.id)}
            className={`rounded border-2 p-0.5 ${m.id === source.id ? "border-zinc-900" : "border-transparent"}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={m.previewUrl} alt={m.alt ?? ""} className="h-14 w-14 object-cover" />
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" name="ai-photo-style" checked={style === "white"} onChange={() => setStyle("white")} />
          White background (best as the main photo)
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="ai-photo-style" checked={style === "scene"} onChange={() => setStyle("scene")} />
          In a scene
        </label>
      </div>
      {style === "scene" && (
        <s-text-field
          label="Scene (optional)"
          placeholder="e.g. on a wooden kitchen table in morning light"
          details={`${scene.length}/${MAX_SCENE_LENGTH}`}
          value={scene}
          ref={listen("input", (el) => setScene(el.value))}
        />
      )}
      <s-stack direction="inline" gap="small" alignItems="center">
        <s-button
          variant={primary ? "primary" : "secondary"}
          disabled={locked || busy !== null || remaining === 0 || scene.length > MAX_SCENE_LENGTH || undefined}
          loading={busy === "ai-photo" || undefined}
          ref={listen("click", create)}
        >
          Create photo with AI
        </s-button>
        <s-text tone="neutral">
          {remaining} of {ai.limit} AI photos left this month{remaining === 0 ? " (they renew on the 1st)" : ""}
        </s-text>
      </s-stack>
      {busy === "ai-photo" && <s-text tone="neutral">Making the photo, this can take up to a minute…</s-text>}
      {primary && <s-text tone="neutral">Shoppers trust a product more with several photos: a white-background photo first, then two or three in a scene.</s-text>}
    </s-stack>
  );
}
