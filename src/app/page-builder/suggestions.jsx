"use client";

import Link from "next/link";
import { BTN, CARD, H2, Pill } from "@/app/ui/kit";
import { BLOCK_LABELS } from "@/lib/page-builder";
import { STATUS_INFO } from "@/lib/status-info";

/**
 * Blocks that would help the store's products, with why (from each product's status, diagnosis, stock
 * and "often bought together"). "Use it" turns the block on for that product and saves.
 */
export function Suggestions({ suggestions, locked, busy, onUse }) {
  if (!suggestions?.length) return null;
  return (
    <section aria-labelledby="suggestions" className={`${CARD} flex flex-col gap-3 px-5 py-4`}>
      <div>
        <h2 id="suggestions" className={H2}>
          Suggested for your products
        </h2>
        <p className="mt-1 mb-0 text-[13px] text-muted">From each product&apos;s status, diagnosis and stock. &quot;Use it&quot; turns the block on for that product only, and saves.</p>
      </div>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {suggestions.map((product) => (
          <li key={product.id} className="flex flex-col gap-1.5 rounded-lg border border-hair px-3 py-2.5">
            <span className="flex flex-wrap items-center gap-2">
              <Link href={`/products/${product.id}`} className="text-[13px] font-semibold">
                {product.title}
              </Link>
              {STATUS_INFO[product.status] && <Pill tone={product.status}>{STATUS_INFO[product.status].label}</Pill>}
            </span>
            {product.suggestions.map((s) => {
              const key = `${product.gid}:${s.type}`;
              return (
                <span key={s.type} className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                  <span>
                    <strong>{BLOCK_LABELS[s.type]}</strong> <span className="text-muted">· {s.reason}</span>
                  </span>
                  <button type="button" disabled={locked || Boolean(busy)} onClick={() => onUse(product, s.type)} className={`${BTN.tiny} cursor-pointer`}>
                    {busy === key ? "Saving…" : "Use it"}
                  </button>
                </span>
              );
            })}
          </li>
        ))}
      </ul>
    </section>
  );
}
