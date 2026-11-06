"use client";

import { CARD, H2 } from "@/app/ui/kit";
import { DEFAULT_LAYOUT, lowStockText } from "@/lib/page-builder";
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

/** The page builder's blocks that are on, in order. */
function Blocks({ blocks }) {
  const shown = blocks.filter((b) => b.enabled);
  if (!shown.length) return <p className="m-0 text-[13px] text-muted">Turn a block on to see it here.</p>;
  return shown.map((block) => {
    const Block = BLOCKS[block.type];
    return (
      <div key={block.type} className="border-t border-hair pt-3 first:border-t-0 first:pt-0">
        <Scope useFor={block.useFor} />
        <Block settings={block.settings} />
      </div>
    );
  });
}

const GALLERY = {
  thumbnails: () => (
    <div className="flex flex-col gap-1.5">
      <span className={`${SHAPE} aspect-[4/3]`} />
      <span className="flex gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`${SHAPE} size-8 ${i === 0 ? "ring-2 ring-ink-2" : ""}`} />
        ))}
      </span>
    </div>
  ),
  stacked: () => (
    <div className="flex flex-col gap-1.5">
      <span className={`${SHAPE} aspect-[4/3]`} />
      <span className={`${SHAPE} aspect-[4/3]`} />
    </div>
  ),
  single: () => <span className={`${SHAPE} aspect-[4/3]`} />,
};

/** One part of the full product page, as a sketch. */
function Part({ type, layout, blocks }) {
  switch (type) {
    case "gallery": {
      const Gallery = GALLERY[layout.gallery] ?? GALLERY.thumbnails;
      return <Gallery />;
    }
    case "title":
      return (
        <div className="flex flex-col gap-1">
          {layout.vendor && <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">Vendor</span>}
          <span className="text-base font-bold">Linen shirt</span>
        </div>
      );
    case "price":
      return (
        <span className="flex items-center gap-2 text-sm">
          <strong>€39.00</strong>
          <s className="text-muted">€49.00</s>
          {layout.saleBadge && <span className="rounded-full border border-ink-2 px-1.5 text-[10px] font-semibold">Sale</span>}
        </span>
      );
    case "variants":
      return (
        <span className="flex gap-2">
          <span className="rounded-md border border-line-strong px-2 py-1 text-xs">Size: M ▾</span>
          <span className="rounded-md border border-line-strong px-2 py-1 text-xs">Color: Sand ▾</span>
        </span>
      );
    case "quantity":
      return <span className="w-16 rounded-md border border-line-strong px-2 py-1 text-xs">Qty 1</span>;
    case "buy_buttons":
      return (
        <div className="flex flex-col gap-1.5">
          <span className="rounded-md border border-ink py-2 text-center text-[13px] font-semibold">Add to cart</span>
          {layout.buyNow && <span className="rounded-md bg-ink py-2 text-center text-[13px] font-semibold text-white">Buy it now</span>}
        </div>
      );
    case "blocks":
      return (
        <div className="flex flex-col gap-3 rounded-md border border-dashed border-line-strong p-2.5">
          <Blocks blocks={blocks} />
        </div>
      );
    case "description":
      return (
        <div className="flex flex-col gap-1">
          <span className={`${SHAPE} h-2.5 w-full`} />
          <span className={`${SHAPE} h-2.5 w-11/12`} />
          <span className={`${SHAPE} h-2.5 w-2/3`} />
        </div>
      );
    default:
      return null;
  }
}

/**
 * A sample product page (unsaved changes included): the full page's parts in their order, with the
 * blocks that are on where "Your blocks" sits. On the store, two columns put the photos on the left.
 */
export function Preview({ blocks, layout = DEFAULT_LAYOUT }) {
  const parts = layout.elements.filter((e) => e.enabled).map((e) => e.type);
  // Two columns: the photos come first (left on wide screens), the rest in order.
  const ordered = layout.columns === 2 && parts.includes("gallery") ? ["gallery", ...parts.filter((t) => t !== "gallery")] : parts;
  return (
    <section aria-labelledby="preview" className={`${CARD} flex flex-col gap-3 px-5 py-4 lg:sticky lg:top-4`}>
      <h2 id="preview" className={H2}>
        Preview
      </h2>
      <div className="flex flex-col gap-3 rounded-lg border border-hair p-3.5">
        {ordered.map((type) => (
          <Part key={type} type={type} layout={layout} blocks={blocks} />
        ))}
      </div>
      <p className="m-0 text-xs text-muted">
        The full page with the <strong>Unstuck product page</strong> block{layout.columns === 2 ? " (photos on the left on wider screens)" : ""}. With <strong>Product page boost</strong> only the dashed part shows, in
        your theme&apos;s page. Both take your theme&apos;s fonts and colors.
      </p>
    </section>
  );
}
