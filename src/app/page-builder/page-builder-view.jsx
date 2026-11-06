"use client";

import { useEffect, useState } from "react";
import { apiError } from "@/app/api-error";
import { BTN, CARD, H2, Notice, PageHeader, UpgradeNotice } from "@/app/ui/kit";
import { BLOCK_LABELS } from "@/lib/page-builder";
import { BlockSettings } from "./block-settings";
import { Preview } from "./preview";
import { UseFor } from "./use-for";

const SUBTITLE = "Blocks for your product pages. Turn them on, put them in order, and choose which products show them.";

const BLOCK_HINTS = {
  low_stock: "Shows how many are left when stock runs low, for the variant the shopper picked.",
  trust_badges: "Short promises under the buy button: shipping, returns, secure checkout.",
  size_chart: "A size table shoppers open on the page.",
  bought_together: "Products bought in the same orders, from your last 60 days of sales.",
};

function useCollections() {
  const [collections, setCollections] = useState(null);
  useEffect(() => {
    fetch("/api/collections")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => setCollections(body?.collections ?? []))
      .catch(() => setCollections([]));
  }, []);
  return collections;
}

/** Moves the block at `index` up (-1) or down (+1). */
function moved(blocks, index, step) {
  const next = [...blocks];
  [next[index], next[index + step]] = [next[index + step], next[index]];
  return next;
}

/** "Add to theme" leaves the app: the theme editor opens in the admin, with the block ready to place. */
function openThemeEditor(url) {
  window.open(url, "_top");
}

/**
 * Page builder: the product page blocks (on/off, order, settings, "Use for") with a preview. Saving
 * writes them to the shop's metafield, which the app's theme block reads.
 */
export function PageBuilderView() {
  const [data, setData] = useState(null);
  const [blocks, setBlocks] = useState(null);
  const [titles, setTitles] = useState({});
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [blockErrors, setBlockErrors] = useState({});
  const collections = useCollections();

  function load(body) {
    setData(body);
    setBlocks(body.pageBuilder.blocks);
    setTitles(body.productTitles);
  }

  useEffect(() => {
    fetch("/api/page-builder")
      .then(async (res) => {
        if (!res.ok) throw await apiError(res);
        load(await res.json());
      })
      .catch((e) => setLoadError(e.message));
  }, []);

  const locked = Boolean(data?.upgrade);

  function update(index, change) {
    setBlocks((current) => current.map((b, i) => (i === index ? { ...b, ...change } : b)));
    setMessage(null);
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    setBlockErrors({});
    try {
      const res = await fetch("/api/page-builder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocks }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 400 && body.errors) {
        setBlockErrors(Object.fromEntries(body.errors.map((e) => [e.field, e.message])));
        setMessage({ tone: "bad", text: "Some blocks need a fix before saving." });
        return;
      }
      if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`);
      load(body);
      setMessage({ tone: "good", text: "Saved. Your product pages show the blocks that are on." });
    } catch (e) {
      setMessage({ tone: "bad", text: e.message });
    } finally {
      setSaving(false);
    }
  }

  const actions = data && (
    <>
      <button type="button" onClick={() => openThemeEditor(data.themeEditorUrl)} className={`${BTN.secondary} cursor-pointer`}>
        Add to theme
      </button>
      <button type="button" disabled={saving || locked} onClick={save} className={`${BTN.primary} cursor-pointer`}>
        {saving ? "Saving…" : "Save"}
      </button>
    </>
  );

  return (
    <>
      <PageHeader title="Page builder" subtitle={SUBTITLE} actions={actions} />
      {loadError && <Notice tone="bad">{loadError}</Notice>}
      {!data && !loadError && <p className="m-0 text-muted">Loading the page builder…</p>}
      {locked && <UpgradeNotice>{data.error}</UpgradeNotice>}
      {message && (
        <Notice tone={message.tone} compact role={message.tone === "bad" ? "alert" : "status"}>
          {message.text}
        </Notice>
      )}

      {blocks && (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,1fr)]">
          <div className="flex min-w-0 flex-col gap-3">
            <ThemeSteps />
            {blocks.map((block, index) => (
              <BlockCard
                key={block.type}
                block={block}
                index={index}
                count={blocks.length}
                locked={locked}
                error={blockErrors[block.type]}
                collections={collections}
                titles={titles}
                boughtTogetherProducts={data.boughtTogetherProducts}
                onChange={(change) => update(index, change)}
                onMove={(step) => setBlocks((current) => moved(current, index, step))}
                onTitles={(more) => setTitles((current) => ({ ...current, ...more }))}
              />
            ))}
          </div>
          <Preview blocks={blocks} />
        </div>
      )}
    </>
  );
}

function ThemeSteps() {
  return (
    <section className={`${CARD} px-5 py-4 text-[13px] text-ink-2`}>
      <h2 className={H2}>How it gets on your store</h2>
      <ol className="mt-2 mb-0 flex flex-col gap-1 pl-5">
        <li>Turn blocks on below and save.</li>
        <li>
          Click <strong>Add to theme</strong>: the theme editor opens with the <strong>Product page boost</strong> block. Place it (e.g. under the buy buttons) and save the theme.
        </li>
        <li>Your theme&apos;s code isn&apos;t changed; remove the block in the theme editor any time.</li>
      </ol>
    </section>
  );
}

function BlockCard({ block, index, count, locked, error, collections, titles, boughtTogetherProducts, onChange, onMove, onTitles }) {
  const id = `block-${block.type}`;
  const label = BLOCK_LABELS[block.type];
  return (
    <section aria-labelledby={id} className={`${CARD} flex flex-col gap-3 px-5 py-4 ${block.enabled ? "" : "bg-head"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2.5">
          <input type="checkbox" checked={block.enabled} disabled={locked} onChange={(e) => onChange({ enabled: e.target.checked })} className="size-4" />
          <span id={id} className={H2}>
            {index + 1}. {label}
          </span>
        </label>
        <span className="flex gap-1.5">
          <button type="button" disabled={locked || index === 0} onClick={() => onMove(-1)} aria-label={`Move ${label} up`} className={`${BTN.tiny} cursor-pointer`}>
            ↑
          </button>
          <button type="button" disabled={locked || index === count - 1} onClick={() => onMove(1)} aria-label={`Move ${label} down`} className={`${BTN.tiny} cursor-pointer`}>
            ↓
          </button>
        </span>
      </div>
      <p className="m-0 text-[13px] text-muted">{BLOCK_HINTS[block.type]}</p>
      {block.type === "bought_together" && block.enabled && (
        <p className="m-0 text-[13px] text-muted">
          {boughtTogetherProducts
            ? `Found for ${boughtTogetherProducts.toLocaleString()} product${boughtTogetherProducts === 1 ? "" : "s"}; refreshed every night.`
            : "Worked out after you save, then every night. Products bought together in at least 2 orders show."}
        </p>
      )}
      {error && (
        <Notice tone="bad" compact role="alert">
          {error}
        </Notice>
      )}
      <fieldset disabled={locked} className="m-0 flex flex-col gap-3 border-0 p-0">
        <BlockSettings type={block.type} settings={block.settings} onChange={(settings) => onChange({ settings })} />
        <UseFor useFor={block.useFor} collections={collections} titles={titles} onChange={(useFor) => onChange({ useFor })} onTitles={onTitles} />
      </fieldset>
    </section>
  );
}
