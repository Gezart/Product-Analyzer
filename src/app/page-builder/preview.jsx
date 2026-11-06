"use client";

import { CARD, H2 } from "@/app/ui/kit";
import { lowStockText } from "@/lib/page-builder";
import { ICON_LABELS } from "./block-settings";

/** Stock of the sample product, low enough to show the "Only X left" block. */
const SAMPLE_STOCK = 3;
const SAMPLE_PRODUCTS = ["Canvas tote", "Wool beanie", "Leather wallet", "Cotton socks"];
const SHAPE = "rounded-md bg-[#E5E7EB]";

const SCOPE = { collections: "Some collections", products: "Chosen products" };

function Scope({ useFor }) {
  if (useFor.mode === "all") return null;
  return <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.04em] text-muted">{SCOPE[useFor.mode]} only</span>;
}

function LowStock({ settings }) {
  if (SAMPLE_STOCK > settings.threshold) return <p className="m-0 text-[13px] text-muted">Hidden: the sample has {SAMPLE_STOCK} left (shows at {settings.threshold} or fewer).</p>;
  return <p className="m-0 text-sm font-semibold text-[#B45309]">{lowStockText(settings.text, SAMPLE_STOCK)}</p>;
}

function TrustBadges({ settings }) {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1.5 p-0 text-[13px]">
      {settings.items.map((item, i) => (
        <li key={i} className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block size-4 rounded-full border-2 border-ink-2" title={ICON_LABELS[item.icon]} />
          {item.text || "…"}
        </li>
      ))}
    </ul>
  );
}

function SizeChart({ settings }) {
  const [head, ...body] = settings.rows;
  return (
    <details className="text-[13px]">
      <summary className="cursor-pointer font-semibold underline">{settings.label || "Size chart"}</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {head.map((cell, i) => (
                <th key={i} className="border-b border-line px-1.5 py-1 text-left">
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, r) => (
              <tr key={r}>
                {row.map((cell, i) => (
                  <td key={i} className="border-b border-hair px-1.5 py-1">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {settings.note && <p className="mt-1.5 mb-0 text-muted">{settings.note}</p>}
    </details>
  );
}

function BoughtTogether({ settings }) {
  return (
    <div>
      <p className="m-0 mb-2 text-sm font-semibold">{settings.title || "Often bought together"}</p>
      <div className="grid grid-cols-2 gap-2">
        {SAMPLE_PRODUCTS.slice(0, settings.max).map((title) => (
          <div key={title} className="flex flex-col gap-1 text-xs">
            <span className={`${SHAPE} aspect-square`} />
            {title}
          </div>
        ))}
      </div>
    </div>
  );
}

const BLOCKS = { low_stock: LowStock, trust_badges: TrustBadges, size_chart: SizeChart, bought_together: BoughtTogether };

/** A sample product page with the blocks that are on, in order (unsaved changes included). */
export function Preview({ blocks }) {
  const shown = blocks.filter((b) => b.enabled);
  return (
    <section aria-labelledby="preview" className={`${CARD} flex flex-col gap-3 px-5 py-4 lg:sticky lg:top-4`}>
      <h2 id="preview" className={H2}>
        Preview
      </h2>
      <div className="flex flex-col gap-3 rounded-lg border border-hair p-3.5">
        <span className={`${SHAPE} aspect-[4/3]`} />
        <span className={`${SHAPE} h-4 w-2/3`} />
        <span className={`${SHAPE} h-3.5 w-1/4`} />
        <span className="rounded-md bg-ink py-2 text-center text-[13px] font-semibold text-white">Add to cart</span>
        {shown.length === 0 && <p className="m-0 text-[13px] text-muted">Turn a block on to see it here.</p>}
        {shown.map((block) => {
          const Block = BLOCKS[block.type];
          return (
            <div key={block.type} className="border-t border-hair pt-3">
              <Scope useFor={block.useFor} />
              <Block settings={block.settings} />
            </div>
          );
        })}
      </div>
      <p className="m-0 text-xs text-muted">The blocks take your theme&apos;s fonts and colors, so they look a little different on your store.</p>
    </section>
  );
}
