"use client";

import { useEffect, useState } from "react";
import { apiError } from "@/app/api-error";
import { BTN, CARD, H2, Notice } from "@/app/ui/kit";
import { KIND_LABELS, KINDS, textPreview } from "@/lib/ab-tests";

const INPUT = "w-full min-w-0 rounded-lg border border-line-strong bg-white px-2.5 py-2 font-[inherit] text-[13px]";
const LABEL = "text-[13px] font-semibold";
const BOX = "rounded-lg border border-line bg-head px-3 py-2 text-[13px]";

const KIND_HINTS = {
  title: "A clearer or more specific name.",
  description: "Other words, details or order in the description.",
  images: "Another photo first, or the photos in another order.",
};

/** Whether the product can have a photos test: only photos (no video or 3D), at least 2. */
const photosTestable = (media) => media.length >= 2 && media.every((m) => m.type === "IMAGE");

/** The product's part of the page as it is now (A), as the API expects it back. */
function currentOf(kind, product) {
  if (kind === "title") return { title: product.title };
  if (kind === "description") return { descriptionHtml: product.descriptionHtml };
  return { mediaIds: product.media.map((m) => m.id) };
}

/** Product picker → the product's title, description and photos as they are now. */
async function loadProduct(query) {
  const res = await fetch(`/api/ab-tests/product?${query}`);
  if (!res.ok) throw await apiError(res);
  return res.json();
}

/**
 * A new test: the product, what to test, and version B next to the page as it is (A). `productId`
 * opens it with that product (from a product's page).
 */
export function NewTest({ productId, onStarted, onClose }) {
  const [product, setProduct] = useState(null);
  const [kind, setKind] = useState("title");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [order, setOrder] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(false);

  function show(body) {
    setProduct(body);
    setTitle(body.title);
    setDescription(body.descriptionHtml ?? "");
    setOrder(body.media.map((m) => m.id));
    setKind("title");
  }

  async function open(query) {
    setLoading(true);
    setError(null);
    try {
      show(await loadProduct(query));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (productId) open(`id=${encodeURIComponent(productId)}`);
  }, [productId]);

  async function pick() {
    if (!window.shopify) return;
    const picked = await window.shopify.resourcePicker({ type: "product", multiple: false, action: "select" });
    if (picked?.[0]) open(`gid=${encodeURIComponent(picked[0].id)}`);
  }

  const b = kind === "title" ? { title } : kind === "description" ? { descriptionHtml: description } : { mediaIds: order };

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/ab-tests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.product.id, kind, b, expected: currentOf(kind, product) }),
      });
      if (!res.ok) throw await apiError(res);
      onStarted(product.product.title);
    } catch (e) {
      setError(e.message);
    } finally {
      setStarting(false);
    }
  }

  const media = product?.media ?? [];
  const byId = Object.fromEntries(media.map((m) => [m.id, m]));
  const canPhotos = photosTestable(media);

  return (
    <section aria-labelledby="new-test" className={`${CARD} flex flex-col gap-4 px-5 py-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="new-test" className={H2}>
          New test
        </h2>
        <button type="button" onClick={onClose} className={`${BTN.tiny} cursor-pointer`}>
          Close
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={pick} className={`${BTN.small} cursor-pointer`}>
          {product ? "Choose another product" : "Choose product"}
        </button>
        {loading && <span className="text-[13px] text-muted">Loading the product…</span>}
        {product && !loading && <span className="text-sm font-semibold">{product.product.title}</span>}
      </div>

      {error && (
        <Notice tone="bad" compact role="alert">
          {error}
        </Notice>
      )}

      {product?.running && (
        <Notice tone="warn" compact>
          A test is already running on this product. Stop it, or use its B, before starting another.
        </Notice>
      )}

      {product && !product.running && (
        <>
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className={`${LABEL} mb-1.5`}>What to test</legend>
            <div className="flex flex-wrap gap-2">
              {KINDS.map((k) => {
                const disabled = k === "images" && !canPhotos;
                return (
                  <label key={k} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] ${kind === k ? "border-ink" : "border-line-strong"} ${disabled ? "opacity-50" : "cursor-pointer"}`}>
                    <input type="radio" name="kind" value={k} checked={kind === k} disabled={disabled} onChange={() => setKind(k)} />
                    <span>
                      <span className="font-semibold">{KIND_LABELS[k]}</span> <span className="text-muted">· {KIND_HINTS[k]}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            {!canPhotos && <p className="m-0 text-[13px] text-muted">Photos tests need at least 2 photos and no videos or 3D models.</p>}
          </fieldset>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className={LABEL}>A · your page now (half the visitors)</span>
              {kind === "title" && <div className={BOX}>{product.title}</div>}
              {kind === "description" && <div className={`${BOX} max-h-[220px] overflow-auto whitespace-pre-wrap`}>{textPreview(product.descriptionHtml, 2000) || "No description"}</div>}
              {kind === "images" && <Photos ids={media.map((m) => m.id)} byId={byId} />}
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className={LABEL}>B · the other half</span>
              {kind === "title" && <input type="text" aria-label="Version B title" value={title} maxLength={255} onChange={(e) => setTitle(e.target.value)} className={INPUT} />}
              {kind === "description" && (
                <>
                  <textarea aria-label="Version B description (HTML)" value={description} onChange={(e) => setDescription(e.target.value)} rows={9} className={`${INPUT} font-mono text-xs`} />
                  <span className="text-xs text-muted">HTML, as in Shopify&apos;s description editor.</span>
                </>
              )}
              {kind === "images" && <Photos ids={order} byId={byId} onMove={setOrder} />}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="m-0 max-w-[560px] text-[13px] text-muted">
              Your product in Shopify doesn&apos;t change while the test runs. B shows on the product page only, to visitors who allow tracking.
            </p>
            <button type="button" disabled={starting} onClick={start} className={`${BTN.primary} cursor-pointer`}>
              {starting ? "Starting…" : "Start test"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/** Photos in order; with `onMove`, each can move left or right, or go first. */
function Photos({ ids, byId, onMove }) {
  const move = (from, to) => {
    const next = [...ids];
    const [id] = next.splice(from, 1);
    next.splice(to, 0, id);
    onMove(next);
  };
  return (
    <ol className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2 p-0">
      {ids.map((id, i) => (
        <li key={id} className="flex flex-col gap-1">
          <div className="relative aspect-square overflow-hidden rounded-lg border border-line bg-head">
            {byId[id]?.previewUrl && <img src={byId[id].previewUrl} alt={byId[id].alt ?? ""} className="size-full object-cover" />}
            <span className="absolute top-1 left-1 rounded bg-white/90 px-1.5 text-[11px] font-semibold">{i + 1}</span>
          </div>
          {onMove && (
            <span className="flex justify-between gap-1">
              <button type="button" disabled={i === 0} onClick={() => move(i, i - 1)} aria-label={`Move photo ${i + 1} left`} className={`${BTN.tiny} cursor-pointer px-2`}>
                ←
              </button>
              <button type="button" disabled={i === 0} onClick={() => move(i, 0)} className={`${BTN.tiny} cursor-pointer px-2`}>
                First
              </button>
              <button type="button" disabled={i === ids.length - 1} onClick={() => move(i, i + 1)} aria-label={`Move photo ${i + 1} right`} className={`${BTN.tiny} cursor-pointer px-2`}>
                →
              </button>
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
