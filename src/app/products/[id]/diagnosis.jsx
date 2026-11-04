"use client";

import Link from "next/link";
import { CARD, H2, Notice, PILL_TONES, UpgradeNotice } from "@/app/ui/kit";
import { REASON_TITLES } from "@/lib/diagnosis-titles";
import { reasonAction } from "@/lib/product-page";

const SEVERITY = { high: "High", medium: "Medium", low: "Low" };
const CTA = "flex-none rounded-lg border border-line-strong bg-white px-2.5 py-1.5 text-[13px] font-semibold whitespace-nowrap text-ink no-underline hover:bg-head hover:text-ink";

/** A link within the page, to another page, or to the Shopify admin. */
function Go({ href, className, children }) {
  return href.startsWith("/") ? (
    <Link href={href} className={className}>
      {children}
    </Link>
  ) : (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

/**
 * "Why it isn't selling": rule-based reasons, each with its evidence and where to fix it. `diagnosis`:
 * `{ reasons, titles, sellingWell }`, or `{ error }` / `{ upgrade }`; null while it runs.
 */
export function Diagnosis({ productId, diagnosis }) {
  const reasons = diagnosis?.reasons;
  const heading = diagnosis?.sellingWell ? "What could still be better" : "Why it isn't selling";
  return (
    <section id="diagnosis" aria-labelledby="dx" className={`${CARD} flex min-w-0 scroll-mt-4 flex-col gap-1 px-5 py-[18px]`}>
      <h2 id="dx" className={`${H2} mb-1.5`}>
        {heading}
        {reasons?.length > 0 && ` · ${reasons.length} reason${reasons.length === 1 ? "" : "s"}`}
      </h2>
      {diagnosis?.sellingWell && reasons?.length > 0 && (
        <p className="m-0 mb-1 text-[13px] text-muted">This product sells well; these are page improvements, not reasons it isn&apos;t selling.</p>
      )}
      {diagnosis?.error && <Notice tone="bad" className="px-4 py-3 text-[13px]">Could not run the diagnosis.</Notice>}
      {diagnosis?.upgrade && <UpgradeNotice>{diagnosis.upgrade}</UpgradeNotice>}
      {!diagnosis && <p className="m-0 text-[13px] text-muted">Diagnosing…</p>}
      {reasons?.length === 0 && <p className="m-0 text-[13px] text-muted">No problems found on this product&apos;s page or price.</p>}
      {reasons?.map((r) => {
        const action = reasonAction(r.code, productId);
        return (
          <div key={r.code} className="flex flex-wrap items-start gap-x-3 gap-y-2 border-t border-hair py-[11px]">
            <span className={`mt-0.5 flex-none rounded-md px-[7px] py-px text-[11px] font-bold ${PILL_TONES[r.severity] ?? PILL_TONES.low}`}>{SEVERITY[r.severity] ?? r.severity}</span>
            <div className="min-w-0 flex-[1_1_220px]">
              <p className="m-0 font-semibold">{REASON_TITLES[r.code] ?? r.code}</p>
              <p className="mt-0.5 mb-0 text-[13px] text-muted">{r.evidence}</p>
              <ReasonData reason={r} titles={diagnosis.titles ?? {}} />
            </div>
            <Go href={action.href} className={CTA}>
              {action.cta}
            </Go>
          </div>
        );
      })}
    </section>
  );
}

/** The items behind a reason that the evidence doesn't name by itself. */
function ReasonData({ reason, titles }) {
  if (reason.code === "duplicate_description") {
    const ids = reason.data?.sameAs ?? [];
    return (
      <p className="mt-0.5 mb-0 text-[13px] text-muted">
        Same text as:{" "}
        {ids.map((id, i) => (
          <span key={id}>
            {i > 0 && ", "}
            <Link href={`/products/${id}`}>{titles[id] ?? `product ${i + 1}`}</Link>
          </span>
        ))}
      </p>
    );
  }
  if (reason.code === "low_traffic_collections") {
    const views = reason.data?.collectionViews ?? [];
    return <p className="mt-0.5 mb-0 text-[13px] text-muted">Views per collection (30 days): {views.map((v) => v.toLocaleString()).join(", ")}</p>;
  }
  return null;
}
