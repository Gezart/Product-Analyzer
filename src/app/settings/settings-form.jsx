"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { listen } from "@/app/polaris-events";

// Shares are stored 0–1 and shown as percentages.
const STATUS_FIELDS = [
  { field: "thresholds.deadDays", label: "Dead stock after (days)", details: "Days without a sale while in stock." },
  { field: "thresholds.slowSellThrough", label: "Slow mover below", details: "Sell-through in the last 60 days.", percent: true },
  { field: "thresholds.stockoutCoverDays", label: "Stock-out risk below (days)", details: "Days of stock left at the current sales rate." },
  { field: "thresholds.minViews", label: "Minimum views", details: "Views in 30 days before conversion is judged." },
  { field: "thresholds.pageProblemViewsTop", label: "Page problem: most viewed", details: "Top share of products by views.", percent: true },
  { field: "thresholds.pageProblemConversionRatio", label: "Page problem: conversion below", details: "Share of the store's median conversion.", percent: true },
  { field: "thresholds.hiddenGemViewsBottom", label: "Hidden gem: least viewed", details: "Bottom share of products by views.", percent: true },
];
const DISCOUNT_FIELDS = [
  { field: "marginFloorPct", label: "Minimum margin (%)", details: "A markdown never prices below cost plus this margin." },
  { field: "maxDiscountPct", label: "Maximum discount (%)", details: "The deepest markdown allowed." },
];
const ALL_FIELDS = [...STATUS_FIELDS, ...DISCOUNT_FIELDS];
const LIST_LABELS = {
  excludedCollectionIds: "Excluded collections",
  excludedProductIds: "Excluded products",
  body: "Request",
};

function getValue(s, field) {
  return field.startsWith("thresholds.")
    ? s.thresholds[field.slice("thresholds.".length)]
    : (s[field]);
}

function toDrafts(s) {
  return Object.fromEntries(ALL_FIELDS.map((f) => [f.field, String(f.percent ? Math.round(getValue(s, f.field) * 1000) / 10 : getValue(s, f.field))]));
}

function errorMessage(e) {
  const f = ALL_FIELDS.find((x) => x.field === e.field);
  if (!f) return `${LIST_LABELS[e.field] ?? e.field}: invalid${e.max ? ` (at most ${e.max})` : ""}`;
  const scale = f.percent ? 100 : 1;
  const range = e.min != null && e.max != null ? ` from ${e.min * scale} to ${e.max * scale}` : "";
  return `${f.label}: enter ${e.integer ? "a whole number" : "a number"}${range}`;
}

export function SettingsForm() {
  const [settings, setSettings] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [collections, setCollections] = useState(null);
  const [collectionsError, setCollectionsError] = useState(false);
  const [collectionsTruncated, setCollectionsTruncated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const banner = useRef(null);
  // Save is at the bottom of a long form: bring the result into view.
  useEffect(() => {
    if (message) banner.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [message]);

  function load(s) {
    setSettings(s);
    setDrafts(toDrafts(s));
  }

  useEffect(() => {
    fetch("/api/settings")
      .then(async (res) => (res.ok ? load(await res.json()) : Promise.reject(new Error(await res.text()))))
      .catch((e) => setMessage({ tone: "critical", text: [`Could not load settings: ${e.message}`] }));
    fetch("/api/collections")
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        setCollections(data.collections);
        setCollectionsTruncated(Boolean(data.truncated));
      })
      .catch(() => setCollectionsError(true));
  }, []);

  if (!settings) {
    return message ? <s-banner tone="critical">{message.text[0]}</s-banner> : <s-spinner accessibilityLabel="Loading settings" />;
  }

  function buildPayload(s) {
    const errors = [];
    const thresholds = { ...s.thresholds };
    const payload = { ...s, thresholds };
    for (const f of ALL_FIELDS) {
      const raw = drafts[f.field]?.trim() ?? "";
      const n = Number(raw);
      if (raw === "" || !Number.isFinite(n)) {
        errors.push(`${f.label}: enter a number`);
        continue;
      }
      const value = f.percent ? n / 100 : n;
      if (f.field.startsWith("thresholds.")) thresholds[f.field.slice("thresholds.".length)] = value;
      else payload[f.field] = value;
    }
    // Collections deleted in Shopify can't be unticked, so drop them once the full list has loaded.
    if (collections && !collectionsTruncated) {
      const known = new Set(collections.map((c) => c.id));
      payload.excludedCollectionIds = s.excludedCollectionIds.filter((id) => known.has(id));
    }
    return { payload, errors };
  }

  async function save() {
    if (!settings) return;
    const { payload, errors } = buildPayload(settings);
    if (errors.length) return setMessage({ tone: "critical", text: errors });
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ tone: "critical", text: (body.errors ?? [{ field: "body" }]).map(errorMessage) });
        return;
      }
      load(body);
      setMessage({ tone: "success", text: ["Saved. Your catalog is being re-scored."] });
    } catch (e) {
      setMessage({ tone: "critical", text: [(e).message] });
    } finally {
      setSaving(false);
    }
  }

  async function pickProducts() {
    if (!settings || !window.shopify) return;
    const picked = await window.shopify.resourcePicker({
      type: "product",
      multiple: true,
      action: "select",
      selectionIds: settings.excludedProductIds.map((id) => ({ id })),
    });
    if (!picked) return;
    setSettings({
      ...settings,
      excludedProductIds: picked.map((p) => p.id),
      excludedProducts: picked.map((p) => ({ id: p.id, title: p.title })),
    });
  }

  function removeProduct(id) {
    if (!settings) return;
    setSettings({
      ...settings,
      excludedProductIds: settings.excludedProductIds.filter((p) => p !== id),
      excludedProducts: settings.excludedProducts.filter((p) => p.id !== id),
    });
  }

  function toggleCollection(id, excluded) {
    if (!settings) return;
    const rest = settings.excludedCollectionIds.filter((c) => c !== id);
    setSettings({ ...settings, excludedCollectionIds: excluded ? [...rest, id] : rest });
  }

  const numberField = (f) => (
    <s-number-field
      key={f.field}
      label={f.label}
      details={f.details}
      suffix={f.percent ? "%" : undefined}
      value={drafts[f.field]}
      ref={listen("input", (el) => setDrafts((d) => ({ ...d, [f.field]: el.value })))}
    />
  );

  return (
    <s-stack gap="base">
      {message && (
        <div ref={banner}>
          <s-banner tone={message.tone}>
            {message.text.map((t) => (
              <div key={t}>{t}</div>
            ))}
          </s-banner>
        </div>
      )}

      <s-section heading="Product statuses">
        <div className="grid gap-4 sm:grid-cols-2">{STATUS_FIELDS.map(numberField)}</div>
      </s-section>

      <s-section heading="Discounts">
        <div className="grid gap-4 sm:grid-cols-2">{DISCOUNT_FIELDS.map(numberField)}</div>
        <fieldset className="mt-4 flex flex-col gap-1 border-0 p-0 text-sm">
          <legend className="mb-1 font-medium">When a markdown ends (half the stock sold, or the last step done)</legend>
          {(["restore", "hold"]).map((v) => (
            <label key={v} className="flex items-center gap-2">
              <input type="radio" name="endAction" checked={settings.markdownEndAction === v} onChange={() => setSettings({ ...settings, markdownEndAction: v })} />
              {v === "restore" ? "Restore the original price" : "Keep the last discounted price"}
            </label>
          ))}
        </fieldset>
      </s-section>

      <s-section heading="Excluded products">
        <s-stack gap="small">
          <s-text tone="neutral">These products are not analyzed.</s-text>
          {settings.excludedProducts.map((p) => (
            <s-stack key={p.id} direction="inline" gap="small" alignItems="center">
              <s-text>{p.title}</s-text>
              <s-button variant="tertiary" ref={listen("click", () => removeProduct(p.id))}>
                Remove
              </s-button>
            </s-stack>
          ))}
          <div>
            <s-button ref={listen("click", pickProducts)}>Choose products</s-button>
          </div>
        </s-stack>
      </s-section>

      <s-section heading="Excluded collections">
        <s-stack gap="small">
          <s-text tone="neutral">Products in these collections are not analyzed.</s-text>
          {collectionsError && <s-banner tone="critical">Could not load collections from Shopify.</s-banner>}
          {!collections && !collectionsError && <s-spinner accessibilityLabel="Loading collections" />}
          {collections?.length === 0 && <s-text>No collections found.</s-text>}
          {collections?.map((c) => (
            <s-checkbox
              key={c.id}
              label={c.title}
              checked={settings.excludedCollectionIds.includes(c.id) || undefined}
              ref={listen("change", (el) => toggleCollection(c.id, el.checked))}
            />
          ))}
        </s-stack>
      </s-section>

      <div>
        <s-button variant="primary" loading={saving || undefined} ref={listen("click", save)}>
          Save
        </s-button>
      </div>
      {process.env.NODE_ENV !== "production" && (
        <Link href="/dev/shopifyql" className="text-sm text-zinc-500 hover:underline">
          Developer: ShopifyQL check (product views)
        </Link>
      )}
    </s-stack>
  );
}
