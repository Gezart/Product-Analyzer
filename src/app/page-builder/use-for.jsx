"use client";

import { useId, useState } from "react";
import { BTN } from "@/app/ui/kit";
import { INPUT } from "./block-settings";

const MODES = [
  { mode: "all", label: "All products" },
  { mode: "collections", label: "Products in collections" },
  { mode: "products", label: "Chosen products" },
];

/** Collections shown before the merchant filters the list. */
const COLLECTIONS_SHOWN = 8;
const REMOVE = "cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-[13px] font-semibold text-muted hover:text-ink";

function CollectionPicker({ selected, collections, onChange }) {
  const [filter, setFilter] = useState("");
  if (!collections) return <p className="m-0 text-[13px] text-muted">Loading collections…</p>;
  if (!collections.length) return <p className="m-0 text-[13px] text-muted">No collections found.</p>;

  const query = filter.trim().toLowerCase();
  const matching = collections.filter((c) => c.title.toLowerCase().includes(query));
  // Picked collections always stay visible, so they can be unpicked without searching.
  const shown = query ? matching : [...collections.filter((c) => selected.includes(c.id)), ...collections.filter((c) => !selected.includes(c.id)).slice(0, COLLECTIONS_SHOWN)];
  const toggle = (id, on) => onChange(on ? [...selected, id] : selected.filter((s) => s !== id));

  return (
    <div className="flex flex-col gap-2">
      <input type="search" placeholder="Search collections" aria-label="Search collections" value={filter} onChange={(e) => setFilter(e.target.value)} className={`${INPUT} max-w-[320px]`} />
      <div className="flex flex-col gap-1 text-[13px]">
        {shown.map((c) => (
          <label key={c.id} className="flex items-center gap-2">
            <input type="checkbox" checked={selected.includes(c.id)} onChange={(e) => toggle(c.id, e.target.checked)} />
            {c.title}
          </label>
        ))}
        {query && !matching.length && <span className="text-muted">No collection matches.</span>}
      </div>
    </div>
  );
}

function ProductPicker({ selected, titles, onChange, onTitles }) {
  async function pick() {
    if (!window.shopify) return;
    const picked = await window.shopify.resourcePicker({ type: "product", multiple: true, action: "select", selectionIds: selected.map((id) => ({ id })) });
    if (!picked) return;
    onTitles(Object.fromEntries(picked.map((p) => [p.id, p.title])));
    onChange(picked.map((p) => p.id));
  }

  return (
    <div className="flex flex-col gap-2 text-[13px]">
      {selected.map((id) => (
        <div key={id} className="flex items-center justify-between gap-2">
          <span>{titles[id] ?? id}</span>
          <button type="button" onClick={() => onChange(selected.filter((s) => s !== id))} className={REMOVE}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" onClick={pick} className={`${BTN.tiny} cursor-pointer self-start`}>
        {selected.length ? "Change products" : "Choose products"}
      </button>
    </div>
  );
}

/** Which product pages show the block: all, the products in some collections, or chosen products. */
export function UseFor({ useFor, collections, titles, onChange, onTitles }) {
  const name = useId();
  const setMode = (mode) => onChange({ ...useFor, mode });
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 border-t border-hair p-0 pt-3">
      <legend className="mb-1.5 text-[13px] font-semibold">Use for</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
        {MODES.map(({ mode, label }) => (
          <label key={mode} className="flex items-center gap-1.5">
            <input type="radio" name={name} checked={useFor.mode === mode} onChange={() => setMode(mode)} />
            {label}
          </label>
        ))}
      </div>
      {useFor.mode === "collections" && <CollectionPicker selected={useFor.collectionIds} collections={collections} onChange={(collectionIds) => onChange({ ...useFor, collectionIds })} />}
      {useFor.mode === "products" && <ProductPicker selected={useFor.productIds} titles={titles} onChange={(productIds) => onChange({ ...useFor, productIds })} onTitles={onTitles} />}
    </fieldset>
  );
}
