"use client";

import { BTN, CARD, H2 } from "@/app/ui/kit";
import { LAYOUT_LABELS, REQUIRED_ELEMENTS } from "@/lib/page-builder";
import { INPUT } from "./block-settings";

const LABEL = "text-[13px] font-semibold";

const HINTS = {
  gallery: "The product's photos and videos.",
  variants: "Hidden on products without variants.",
  quantity: "How many to add to the cart.",
  buy_buttons: "Add to cart, and Shopify's Buy it now.",
  blocks: "The blocks below that are on, in their order.",
};

/** Moves the part at `index` up (-1) or down (+1). */
function moved(elements, index, step) {
  const next = [...elements];
  [next[index], next[index + step]] = [next[index + step], next[index]];
  return next;
}

/**
 * The full product page ("Unstuck product page" block): its parts on/off and in order (the parts the
 * page can't sell without stay on), how the photos show, one or two columns, Buy it now, vendor and
 * the sale badge.
 */
export function LayoutSettings({ layout, locked, error, onChange }) {
  const set = (change) => onChange({ ...layout, ...change });
  return (
    <section aria-labelledby="layout" className={`${CARD} flex flex-col gap-3 px-5 py-4`}>
      <div>
        <h2 id="layout" className={H2}>
          Full product page
        </h2>
        <p className="mt-1 mb-0 text-[13px] text-muted">
          With the <strong>Unstuck product page</strong> block, the whole page comes from here: put the parts in order and turn off the ones you don&apos;t need.
        </p>
      </div>
      {error && (
        <p role="alert" className="m-0 text-[13px] font-semibold text-[#B91C1C]">
          {error}
        </p>
      )}
      <fieldset disabled={locked} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
        <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
          {layout.elements.map((element, index) => {
            const required = REQUIRED_ELEMENTS.includes(element.type);
            const label = LAYOUT_LABELS[element.type];
            return (
              <li key={element.type} className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-hair px-3 py-2">
                <label className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[13px]">
                  <input
                    type="checkbox"
                    checked={element.enabled}
                    disabled={required}
                    onChange={(e) => set({ elements: layout.elements.map((x, i) => (i === index ? { ...x, enabled: e.target.checked } : x)) })}
                    className="size-4"
                  />
                  <span className="font-semibold">{label}</span>
                  <span className="min-w-0 text-muted">{required ? "Always on" : HINTS[element.type]}</span>
                </label>
                <span className="flex shrink-0 gap-1.5">
                  <button type="button" disabled={index === 0} onClick={() => set({ elements: moved(layout.elements, index, -1) })} aria-label={`Move ${label} up`} className={`${BTN.tiny} cursor-pointer`}>
                    ↑
                  </button>
                  <button type="button" disabled={index === layout.elements.length - 1} onClick={() => set({ elements: moved(layout.elements, index, 1) })} aria-label={`Move ${label} down`} className={`${BTN.tiny} cursor-pointer`}>
                    ↓
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Photos</span>
            <select value={layout.gallery} onChange={(e) => set({ gallery: e.target.value })} className={INPUT}>
              <option value="thumbnails">Big photo with thumbnails</option>
              <option value="stacked">All photos, one under another</option>
              <option value="single">First photo only</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Columns</span>
            <select value={layout.columns} onChange={(e) => set({ columns: Number(e.target.value) })} className={INPUT}>
              <option value={2}>Two: photos left, the rest right</option>
              <option value={1}>One: everything in order</option>
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={layout.buyNow} onChange={(e) => set({ buyNow: e.target.checked })} />
            Buy it now button
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={layout.vendor} onChange={(e) => set({ vendor: e.target.checked })} />
            Vendor above the title
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={layout.saleBadge} onChange={(e) => set({ saleBadge: e.target.checked })} />
            Sale badge on discounted prices
          </label>
        </div>
      </fieldset>
    </section>
  );
}
