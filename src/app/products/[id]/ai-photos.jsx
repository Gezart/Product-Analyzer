"use client";

import { useState } from "react";
import { BTN } from "@/app/ui/kit";
import { MAX_SCENE_LENGTH } from "@/lib/ai-photo";

/** A request from the photo section: the answer's JSON, or null after showing its error. */
async function call(kind, url, init, { busy, setBusy, setMessage }) {
  if (busy) return null;
  setBusy(kind);
  setMessage(null);
  const res = await fetch(url, init).catch(() => null);
  const body = res ? await res.json().catch(() => ({})) : {};
  setBusy(null);
  if (!res?.ok) {
    setMessage({ tone: "bad", text: body.error ?? `Failed (${res?.status ?? "network"})` });
    return null;
  }
  return body;
}

/**
 * "Create more with AI": pick one of the product's photos and a white background or a scene. The AI's
 * photo joins the suggestions (`onCreated({ id, image, label }, ai)`); it only goes to Shopify when the
 * merchant picks it and applies.
 */
export function AiPhotoMaker({ productId, photos, ai, primary, locked, busy, setBusy, setMessage, onCreated }) {
  const [sourceId, setSourceId] = useState(null);
  const [style, setStyle] = useState("white");
  const [scene, setScene] = useState("");
  const source = photos.find((m) => m.id === sourceId) ?? photos[0];

  async function create() {
    const body = await call(
      "ai-photo",
      `/api/products/${productId}/ai-photo`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mediaId: source.id, style, scene: style === "scene" ? scene : undefined }) },
      { busy, setBusy, setMessage },
    );
    if (body) onCreated({ id: body.draft.id, image: body.draft.image, label: style === "white" ? "White background" : scene.trim() || "In a scene" }, body.ai);
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-[10px] border border-line bg-head px-4 py-3.5">
      <p className="m-0 text-[13px] font-semibold">Start from</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Photo to start from">
        {photos.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={m.id === source.id}
            onClick={() => setSourceId(m.id)}
            className={`cursor-pointer rounded-lg border-2 bg-white p-0.5 ${m.id === source.id ? "border-ink" : "border-transparent"}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={m.previewUrl} alt={m.alt ?? ""} className="block h-14 w-14 rounded-md object-cover" />
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-4 text-[13px]">
        <label className="flex items-center gap-1.5">
          <input type="radio" name="ai-photo-style" checked={style === "white"} onChange={() => setStyle("white")} />
          White background (best as the main photo)
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" name="ai-photo-style" checked={style === "scene"} onChange={() => setStyle("scene")} />
          In a scene
        </label>
      </div>
      {style === "scene" && (
        <div className="flex flex-col gap-1">
          <label htmlFor="ai-scene" className="text-[13px] font-semibold">
            Scene (optional)
          </label>
          <input
            id="ai-scene"
            type="text"
            placeholder="e.g. on a wooden kitchen table in morning light"
            value={scene}
            onChange={(e) => setScene(e.target.value)}
            className="rounded-lg border border-line-strong bg-white px-[11px] py-[9px] font-[inherit]"
          />
          <span className={`text-xs ${scene.length > MAX_SCENE_LENGTH ? "text-[#B91C1C]" : "text-muted"}`}>
            {scene.length} of {MAX_SCENE_LENGTH} characters
          </span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          disabled={locked || busy !== null || ai.left === 0 || scene.length > MAX_SCENE_LENGTH}
          onClick={create}
          className={`${primary ? BTN.smallPrimary : BTN.small} cursor-pointer`}
        >
          {busy === "ai-photo" ? "Making the photo…" : "Create photo"}
        </button>
        <span className="text-[13px] text-muted">
          {ai.left} of {ai.limit} AI photos left this month{ai.left === 0 ? " (they renew on the 1st)" : ""}
        </span>
      </div>
      {busy === "ai-photo" && <p className="m-0 text-[13px] text-muted">This can take up to a minute.</p>}
      {primary && <p className="m-0 text-[13px] text-muted">Shoppers trust a product more with several photos: a white-background photo first, then two or three in a scene.</p>}
    </div>
  );
}

/** A product without a photo: the AI needs one real photo first, so the merchant uploads one (it goes to Shopify now). */
export function PhotoUpload({ productId, locked, busy, setBusy, setMessage, onAdded }) {
  async function upload(input) {
    const file = input.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const body = await call("photo-upload", `/api/products/${productId}/photo`, { method: "POST", body: form }, { busy, setBusy, setMessage });
    input.value = "";
    if (body) await onAdded("Photo added to the product in Shopify. Shopify may take a moment to process it; you can undo it in the history.");
  }
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-dashed border-line-strong px-4 py-3.5">
      <p className="m-0 text-[13px] font-semibold text-[#92400E]">This product has no photo yet. Add one first: the AI starts from a real photo of the product.</p>
      <label className="flex flex-wrap items-center gap-2 text-[13px]">
        <span>Upload a photo (JPEG, PNG or WebP, up to 20 MB):</span>
        <input type="file" accept="image/jpeg,image/png,image/webp" disabled={locked || busy !== null} onChange={(e) => upload(e.target)} />
      </label>
      {busy === "photo-upload" && <p className="m-0 text-[13px] text-muted">Uploading…</p>}
    </div>
  );
}
