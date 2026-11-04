"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { apiError } from "@/app/api-error";
import { BTN, CARD, H2, Notice, PageHeader } from "@/app/ui/kit";

// Shares are stored 0–1 and shown as percentages.
const STATUS_FIELDS = [
  { field: "thresholds.deadDays", label: "Dead stock after", details: "Days without a sale while in stock.", suffix: "days" },
  { field: "thresholds.slowSellThrough", label: "Slow mover below", details: "Sell-through in the last 60 days.", percent: true },
  { field: "thresholds.stockoutCoverDays", label: "Stock-out risk below", details: "Days of stock left at the current sales rate.", suffix: "days" },
  { field: "thresholds.minViews", label: "Minimum views", details: "Views in 30 days before conversion is judged." },
  { field: "thresholds.pageProblemViewsTop", label: "Page problem: most viewed", details: "Top share of products by views.", percent: true },
  { field: "thresholds.pageProblemConversionRatio", label: "Page problem: conversion below", details: "Share of the store's median conversion.", percent: true },
  { field: "thresholds.hiddenGemViewsBottom", label: "Hidden gem: least viewed", details: "Bottom share of products by views.", percent: true },
];
const DIAGNOSIS_FIELDS = [
  { field: "thresholds.marketAbove", label: "Flag when above market by", details: "High importance from 25% (or from this, if it's higher).", percent: true },
];
const DISCOUNT_FIELDS = [
  { field: "marginFloorPct", label: "Minimum margin", details: "Markdowns never go below cost + this margin.", suffix: "%" },
  { field: "maxDiscountPct", label: "Maximum discount", details: "The deepest a markdown can go.", suffix: "%" },
];
const ALL_FIELDS = [...STATUS_FIELDS, ...DIAGNOSIS_FIELDS, ...DISCOUNT_FIELDS];
const LIST_LABELS = {
  seasonalCollections: "Seasonal collections",
  excludedCollectionIds: "Excluded collections",
  excludedProductIds: "Excluded products",
  body: "Request",
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const selectClass = "rounded-lg border border-line-strong bg-white px-2.5 py-2 font-[inherit] text-[13px]";

/** A month picker (1–12). */
function MonthSelect({ label, value, onChange }) {
  return (
    <label className="flex flex-col gap-1 text-[13px] font-semibold">
      {label}
      <select className={selectClass} value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {MONTHS.map((m, i) => (
          <option key={m} value={i + 1}>
            {m}
          </option>
        ))}
      </select>
    </label>
  );
}

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

/** A settings card (the design): a heading, then its fields. */
function Section({ id, title, children }) {
  return (
    <section aria-labelledby={id} className={`${CARD} flex flex-col gap-3 px-5 py-[18px]`}>
      <h2 id={id} className={H2}>
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * Merchant rules (the owner's design): statuses, prices and discounts, market price (with Google
 * Merchant Center, `googleMerchant`), seasonal products and what isn't analyzed.
 */
export function SettingsForm({ googleMerchant }) {
  const [settings, setSettings] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [collections, setCollections] = useState(null);
  const [collectionsError, setCollectionsError] = useState(false);
  const [collectionsTruncated, setCollectionsTruncated] = useState(false);
  const [newSeason, setNewSeason] = useState({ collectionId: "", from: 11, to: 2 });
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
      .then(async (res) => (res.ok ? load(await res.json()) : Promise.reject(await apiError(res))))
      .catch((e) => setMessage({ tone: "bad", text: [`Could not load settings: ${e.message}`] }));
    fetch("/api/collections")
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        setCollections(data.collections);
        setCollectionsTruncated(Boolean(data.truncated));
      })
      .catch(() => setCollectionsError(true));
  }, []);

  const header = (actions) => <PageHeader title="Settings" subtitle="Changes re-score your products within a minute." actions={actions} />;
  if (!settings) {
    return (
      <>
        {header()}
        {message ? <Notice tone="bad">{message.text[0]}</Notice> : <p className="m-0 text-muted">Loading settings…</p>}
      </>
    );
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
      payload.seasonalCollections = s.seasonalCollections.filter((c) => known.has(c.collectionId));
    }
    return { payload, errors };
  }

  async function save() {
    if (!settings) return;
    const { payload, errors } = buildPayload(settings);
    if (errors.length) return setMessage({ tone: "bad", text: errors });
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
        setMessage({ tone: "bad", text: (body.errors ?? [{ field: "body" }]).map(errorMessage) });
        return;
      }
      load(body);
      setMessage({ tone: "good", text: ["Saved. Your catalog is being re-scored."] });
    } catch (e) {
      setMessage({ tone: "bad", text: [e.message] });
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

  const setSeasons = (seasonalCollections) => setSettings({ ...settings, seasonalCollections });
  function addSeason() {
    if (!newSeason.collectionId) return;
    setSeasons([...settings.seasonalCollections.filter((c) => c.collectionId !== newSeason.collectionId), newSeason]);
    setNewSeason({ ...newSeason, collectionId: "" });
  }
  // Beyond a cut-off list a collection may still exist: show its number, not "no longer in Shopify".
  const collectionTitle = (id) =>
    collections?.find((c) => c.id === id)?.title ?? (collections && !collectionsTruncated ? "Collection no longer in Shopify" : `Collection ${id.split("/").pop()}`);

  function toggleCollection(id, excluded) {
    if (!settings) return;
    const rest = settings.excludedCollectionIds.filter((c) => c !== id);
    setSettings({ ...settings, excludedCollectionIds: excluded ? [...rest, id] : rest });
  }

  const numberField = (f) => (
    <div key={f.field} className="flex flex-col gap-1">
      <label htmlFor={f.field} className="text-[13px] font-semibold">
        {f.label}
      </label>
      <span className="flex max-w-[180px] items-center gap-1.5">
        <input
          id={f.field}
          type="text"
          inputMode="decimal"
          value={drafts[f.field] ?? ""}
          onChange={(e) => setDrafts((d) => ({ ...d, [f.field]: e.target.value }))}
          className="w-full min-w-0 rounded-lg border border-line-strong px-2.5 py-2 font-[inherit]"
        />
        {(f.percent || f.suffix) && <span className="flex-none text-[13px] text-muted">{f.percent ? "%" : f.suffix}</span>}
      </span>
      <span className="text-xs text-muted">{f.details}</span>
    </div>
  );
  const saveButton = (
    <button type="button" disabled={saving} onClick={save} className={`${BTN.primary} cursor-pointer`}>
      {saving ? "Saving…" : "Save"}
    </button>
  );
  const REMOVE = "cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-[13px] font-semibold text-muted hover:text-ink";

  return (
    <>
      {header(saveButton)}
      {message && (
        <div ref={banner}>
          <Notice tone={message.tone} compact>
            {message.text.map((t) => (
              <div key={t}>{t}</div>
            ))}
          </Notice>
        </div>
      )}

      <Section id="statuses" title="Statuses">
        <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">{STATUS_FIELDS.map(numberField)}</div>
      </Section>

      <Section id="prices" title="Prices and discounts">
        <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">{DISCOUNT_FIELDS.map(numberField)}</div>
        <fieldset className="m-0 flex flex-col gap-1 border-0 p-0 text-[13px]">
          <legend className="mb-1 font-semibold">When a markdown ends (half the stock sold, or the last step done)</legend>
          {["restore", "hold"].map((v) => (
            <label key={v} className="flex items-center gap-2">
              <input type="radio" name="endAction" checked={settings.markdownEndAction === v} onChange={() => setSettings({ ...settings, markdownEndAction: v })} />
              {v === "restore" ? "Restore the original price" : "Keep the last discounted price"}
            </label>
          ))}
        </fieldset>
      </Section>

      <Section id="market" title="Market price">
        {googleMerchant}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          {DIAGNOSIS_FIELDS.map(numberField)}
          <p className="m-0 flex-[1_1_280px] text-[13px] text-muted">Competitor links are added on each product page and read every night. Only prices in your currency are compared.</p>
        </div>
      </Section>

      <Section id="season" title="Seasonal products">
        <p className="m-0 text-[13px] text-muted">
          Off season, these are not called slow or dead and no markdown starts. In Shopify, tag a product with its months, like <code>season:nov-feb</code> or{" "}
          <code>season:jun-aug</code> (or <code>season:winter</code>: Dec–Feb, northern hemisphere). Or mark whole collections here; a product&apos;s own tag wins.
        </p>
        {settings.seasonalCollections.length > 0 && (
          <ul className="m-0 flex list-none flex-col p-0">
            {settings.seasonalCollections.map((c) => (
              <li key={c.collectionId} className="flex flex-wrap items-end gap-3 border-t border-hair py-2.5">
                <span className="min-w-0 flex-1 self-center">
                  <span className="rounded-full bg-[#CCFBF1] px-2.5 py-[5px] text-[13px] font-semibold text-[#115E59]">{collectionTitle(c.collectionId)}</span>
                </span>
                <MonthSelect label="From" value={c.from} onChange={(from) => setSeasons(settings.seasonalCollections.map((x) => (x === c ? { ...x, from } : x)))} />
                <MonthSelect label="To" value={c.to} onChange={(to) => setSeasons(settings.seasonalCollections.map((x) => (x === c ? { ...x, to } : x)))} />
                <button type="button" onClick={() => setSeasons(settings.seasonalCollections.filter((x) => x !== c))} className={`${REMOVE} self-center`}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {collectionsError && <Notice tone="bad" compact>Could not load collections from Shopify.</Notice>}
        {collections && (
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-0 flex-col gap-1 text-[13px] font-semibold">
              Seasonal collection
              <select className={selectClass} value={newSeason.collectionId} onChange={(e) => setNewSeason({ ...newSeason, collectionId: e.target.value })}>
                <option value="">Choose…</option>
                {collections
                  .filter((c) => !settings.seasonalCollections.some((x) => x.collectionId === c.id))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
              </select>
            </label>
            <MonthSelect label="From" value={newSeason.from} onChange={(from) => setNewSeason({ ...newSeason, from })} />
            <MonthSelect label="To" value={newSeason.to} onChange={(to) => setNewSeason({ ...newSeason, to })} />
            <button type="button" disabled={!newSeason.collectionId} onClick={addSeason} className={`${BTN.small} cursor-pointer`}>
              Add
            </button>
          </div>
        )}
        <p className="m-0 text-xs text-muted">Saved with Save.</p>
      </Section>

      <Section id="excluded" title="Not analyzed">
        <div className="flex flex-col gap-2">
          <p className="m-0 text-[13px] font-semibold">Excluded products</p>
          <p className="m-0 text-xs text-muted">Not analyzed and never changed.</p>
          {settings.excludedProducts.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {settings.excludedProducts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => removeProduct(p.id)}
                  aria-label={`Analyze ${p.title} again`}
                  className="cursor-pointer rounded-full border-0 bg-canvas px-2.5 py-[5px] font-[inherit] text-[13px] font-semibold text-ink"
                >
                  {p.title} ✕
                </button>
              ))}
            </div>
          )}
          <button type="button" onClick={pickProducts} className={`${BTN.small} cursor-pointer self-start`}>
            Choose products
          </button>
        </div>
        <div className="flex flex-col gap-2 border-t border-hair pt-3">
          <p className="m-0 text-[13px] font-semibold">Excluded collections</p>
          <p className="m-0 text-xs text-muted">Products in these collections are not analyzed.</p>
          {collectionsError && <Notice tone="bad" compact>Could not load collections from Shopify.</Notice>}
          {!collections && !collectionsError && <p className="m-0 text-[13px] text-muted">Loading collections…</p>}
          {collections?.length === 0 && <p className="m-0 text-[13px] text-muted">No collections found.</p>}
          {collections?.length > 0 && (
            <div className="grid max-h-72 gap-1 overflow-y-auto sm:grid-cols-2">
              {collections.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" checked={settings.excludedCollectionIds.includes(c.id)} onChange={(e) => toggleCollection(c.id, e.target.checked)} />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{c.title}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </Section>

      <div className="flex justify-end">{saveButton}</div>
      {process.env.NODE_ENV !== "production" && (
        <Link href="/dev/shopifyql" className="text-[13px] text-muted">
          Developer: ShopifyQL check (product views)
        </Link>
      )}
    </>
  );
}
