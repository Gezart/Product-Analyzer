"use client";

import { useEffect, useState } from "react";

type Thresholds = {
  pageProblemViewsTop: number;
  pageProblemConversionRatio: number;
  hiddenGemViewsBottom: number;
  slowSellThrough: number;
  deadDays: number;
  stockoutCoverDays: number;
  minViews: number;
};

type Settings = {
  thresholds: Thresholds;
  marginFloorPct: number;
  maxDiscountPct: number;
  excludedCollectionIds: string[];
  excludedProductIds: string[];
  excludedProducts: { id: string; title: string }[];
};

type FieldError = { field: string; min?: number; max?: number; integer?: boolean };
type Collection = { id: string; title: string };
type NumberField = { field: string; label: string; details: string; percent?: boolean };

// Shares are stored 0–1 and shown as percentages.
const STATUS_FIELDS: NumberField[] = [
  { field: "thresholds.deadDays", label: "Dead stock after (days)", details: "Days without a sale while in stock." },
  { field: "thresholds.slowSellThrough", label: "Slow mover below", details: "Sell-through in the last 60 days.", percent: true },
  { field: "thresholds.stockoutCoverDays", label: "Stock-out risk below (days)", details: "Days of stock left at the current sales rate." },
  { field: "thresholds.minViews", label: "Minimum views", details: "Views in 30 days before conversion is judged." },
  { field: "thresholds.pageProblemViewsTop", label: "Page problem: most viewed", details: "Top share of products by views.", percent: true },
  { field: "thresholds.pageProblemConversionRatio", label: "Page problem: conversion below", details: "Share of the store's median conversion.", percent: true },
  { field: "thresholds.hiddenGemViewsBottom", label: "Hidden gem: least viewed", details: "Bottom share of products by views.", percent: true },
];
const DISCOUNT_FIELDS: NumberField[] = [
  { field: "marginFloorPct", label: "Minimum margin (%)", details: "A markdown never prices below cost plus this margin." },
  { field: "maxDiscountPct", label: "Maximum discount (%)", details: "The deepest markdown allowed." },
];
const ALL_FIELDS = [...STATUS_FIELDS, ...DISCOUNT_FIELDS];
const LIST_LABELS: Record<string, string> = {
  excludedCollectionIds: "Excluded collections",
  excludedProductIds: "Excluded products",
  body: "Request",
};

function getValue(s: Settings, field: string): number {
  return field.startsWith("thresholds.")
    ? s.thresholds[field.slice("thresholds.".length) as keyof Thresholds]
    : (s[field as "marginFloorPct" | "maxDiscountPct"] as number);
}

function toDrafts(s: Settings): Record<string, string> {
  return Object.fromEntries(ALL_FIELDS.map((f) => [f.field, String(f.percent ? Math.round(getValue(s, f.field) * 1000) / 10 : getValue(s, f.field))]));
}

function errorMessage(e: FieldError): string {
  const f = ALL_FIELDS.find((x) => x.field === e.field);
  if (!f) return `${LIST_LABELS[e.field] ?? e.field}: invalid${e.max ? ` (at most ${e.max})` : ""}`;
  const scale = f.percent ? 100 : 1;
  const range = e.min != null && e.max != null ? ` from ${e.min * scale} to ${e.max * scale}` : "";
  return `${f.label}: enter ${e.integer ? "a whole number" : "a number"}${range}`;
}

/**
 * Ref that listens to a DOM event on a Polaris web component directly, so it works whether or not
 * the component's events bubble to React's root listener.
 */
function listen(event: string, handler: (el: HTMLInputElement) => void) {
  return (el: HTMLElement | null) => {
    if (!el) return;
    const fn = () => handler(el as HTMLInputElement);
    el.addEventListener(event, fn);
    return () => el.removeEventListener(event, fn);
  };
}

export function SettingsForm() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [collectionsError, setCollectionsError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "critical"; text: string[] } | null>(null);

  function load(s: Settings) {
    setSettings(s);
    setDrafts(toDrafts(s));
  }

  useEffect(() => {
    fetch("/api/settings")
      .then(async (res) => (res.ok ? load(await res.json()) : Promise.reject(new Error(await res.text()))))
      .catch((e: Error) => setMessage({ tone: "critical", text: [`Could not load settings: ${e.message}`] }));
    fetch("/api/collections")
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        setCollections((await res.json()).collections);
      })
      .catch(() => setCollectionsError(true));
  }, []);

  if (!settings) {
    return message ? <s-banner tone="critical">{message.text[0]}</s-banner> : <s-spinner accessibilityLabel="Loading settings" />;
  }

  function buildPayload(s: Settings) {
    const errors: string[] = [];
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
      if (f.field.startsWith("thresholds.")) thresholds[f.field.slice("thresholds.".length) as keyof Thresholds] = value;
      else payload[f.field as "marginFloorPct" | "maxDiscountPct"] = value;
    }
    // Collections deleted in Shopify can't be unticked, so drop them once the list has loaded.
    if (collections) {
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
      setMessage({ tone: "critical", text: [(e as Error).message] });
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

  function removeProduct(id: string) {
    if (!settings) return;
    setSettings({
      ...settings,
      excludedProductIds: settings.excludedProductIds.filter((p) => p !== id),
      excludedProducts: settings.excludedProducts.filter((p) => p.id !== id),
    });
  }

  function toggleCollection(id: string, excluded: boolean) {
    if (!settings) return;
    const rest = settings.excludedCollectionIds.filter((c) => c !== id);
    setSettings({ ...settings, excludedCollectionIds: excluded ? [...rest, id] : rest });
  }

  const numberField = (f: NumberField) => (
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
        <s-banner tone={message.tone}>
          {message.text.map((t) => (
            <div key={t}>{t}</div>
          ))}
        </s-banner>
      )}

      <s-section heading="Product statuses">
        <div className="grid gap-4 sm:grid-cols-2">{STATUS_FIELDS.map(numberField)}</div>
      </s-section>

      <s-section heading="Discounts">
        <div className="grid gap-4 sm:grid-cols-2">{DISCOUNT_FIELDS.map(numberField)}</div>
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
    </s-stack>
  );
}
