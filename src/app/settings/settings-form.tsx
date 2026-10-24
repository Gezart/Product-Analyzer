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
};

type Collection = { id: string; title: string };

// Shares are stored 0–1 and shown as percentages.
const THRESHOLD_FIELDS: { key: keyof Thresholds; label: string; details: string; percent?: boolean; min: number; max: number }[] = [
  { key: "deadDays", label: "Dead stock after", details: "Days without a sale while in stock.", min: 14, max: 365 },
  { key: "slowSellThrough", label: "Slow mover below", details: "Sell-through in the last 60 days.", percent: true, min: 1, max: 100 },
  { key: "stockoutCoverDays", label: "Stock-out risk below", details: "Days of stock left at the current sales rate.", min: 1, max: 120 },
  { key: "minViews", label: "Minimum views", details: "Views in 30 days before conversion is judged.", min: 1, max: 10000 },
  { key: "pageProblemViewsTop", label: "Page problem: most viewed", details: "Top share of products by views.", percent: true, min: 5, max: 95 },
  { key: "pageProblemConversionRatio", label: "Page problem: conversion below", details: "Share of the store's median conversion.", percent: true, min: 5, max: 100 },
  { key: "hiddenGemViewsBottom", label: "Hidden gem: least viewed", details: "Bottom share of products by views.", percent: true, min: 5, max: 95 },
];

const inputValue = (e: Event) => Number((e.currentTarget as HTMLInputElement).value);

export function SettingsForm() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "critical"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then(async (res) => (res.ok ? setSettings(await res.json()) : Promise.reject(new Error(await res.text()))))
      .catch((e: Error) => setMessage({ tone: "critical", text: `Could not load settings: ${e.message}` }));
    fetch("/api/collections")
      .then(async (res) => (res.ok ? setCollections((await res.json()).collections) : setCollections([])))
      .catch(() => setCollections([]));
  }, []);

  if (!settings) {
    return message ? <s-banner tone="critical">{message.text}</s-banner> : <s-spinner accessibilityLabel="Loading settings" />;
  }

  const setThreshold = (key: keyof Thresholds, value: number) =>
    setSettings({ ...settings, thresholds: { ...settings.thresholds, [key]: value } });

  const toggleCollection = (id: string, excluded: boolean) =>
    setSettings({
      ...settings,
      excludedCollectionIds: excluded
        ? [...settings.excludedCollectionIds, id]
        : settings.excludedCollectionIds.filter((c) => c !== id),
    });

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const body = await res.json();
      if (!res.ok) throw new Error((body.errors ?? []).join("; ") || res.statusText);
      setSettings(body);
      setMessage({ tone: "success", text: "Saved. Your catalog is being re-scored." });
    } catch (e) {
      setMessage({ tone: "critical", text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <s-stack gap="base">
      {message && <s-banner tone={message.tone}>{message.text}</s-banner>}

      <s-section heading="Product statuses">
        <div className="grid gap-4 sm:grid-cols-2">
          {THRESHOLD_FIELDS.map((f) => {
            const raw = settings.thresholds[f.key];
            return (
              <s-number-field
                key={f.key}
                label={f.label}
                details={f.details}
                min={f.min}
                max={f.max}
                step={1}
                suffix={f.percent ? "%" : undefined}
                value={String(f.percent ? Math.round(raw * 100) : raw)}
                onInput={(e: Event) => setThreshold(f.key, f.percent ? inputValue(e) / 100 : inputValue(e))}
              />
            );
          })}
        </div>
      </s-section>

      <s-section heading="Discounts">
        <div className="grid gap-4 sm:grid-cols-2">
          <s-number-field
            label="Minimum margin"
            details="A markdown never prices below cost plus this margin."
            min={0}
            max={100}
            suffix="%"
            value={String(settings.marginFloorPct)}
            onInput={(e: Event) => setSettings({ ...settings, marginFloorPct: inputValue(e) })}
          />
          <s-number-field
            label="Maximum discount"
            details="The deepest markdown allowed."
            min={1}
            max={90}
            suffix="%"
            value={String(settings.maxDiscountPct)}
            onInput={(e: Event) => setSettings({ ...settings, maxDiscountPct: inputValue(e) })}
          />
        </div>
      </s-section>

      <s-section heading="Excluded collections">
        <s-stack gap="small">
          <s-text tone="neutral">Products in these collections are not analyzed.</s-text>
          {collections === null && <s-spinner accessibilityLabel="Loading collections" />}
          {collections?.length === 0 && <s-text>No collections found.</s-text>}
          {collections?.map((c) => (
            <s-checkbox
              key={c.id}
              label={c.title}
              checked={settings.excludedCollectionIds.includes(c.id) || undefined}
              onChange={(e: Event) => toggleCollection(c.id, (e.currentTarget as HTMLInputElement).checked)}
            />
          ))}
        </s-stack>
      </s-section>

      <div>
        <s-button variant="primary" loading={saving || undefined} onClick={save}>
          Save
        </s-button>
      </div>
    </s-stack>
  );
}
