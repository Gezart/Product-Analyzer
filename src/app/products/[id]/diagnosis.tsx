"use client";

import { useEffect, useState } from "react";

type Reason = { code: string; severity: "high" | "medium" | "low"; evidence: string; link: string };

const TITLES: Record<string, string> = {
  price_above_peers: "Price is high for its group",
  few_images: "Too few images",
  short_description: "Description is short",
  missing_details: "Description is missing details",
  duplicate_description: "Description is copied",
  missing_seo: "SEO is incomplete",
  broken_size_run: "Key variants are out of stock",
  no_collection: "Not in any collection",
  low_traffic_collections: "Only in quiet collections",
  store_checkout_issue: "Shoppers drop off at checkout",
};

const TONE = { high: "critical", medium: "warning", low: "info" } as const;

/** "Why it isn't selling": rule-based reasons, each with its numbers and a link to the data. */
export function Diagnosis({ productId }: { productId: string }) {
  const [reasons, setReasons] = useState<Reason[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`/api/products/${productId}/diagnosis`)
      .then(async (res) => (res.ok ? setReasons((await res.json()).reasons) : Promise.reject()))
      .catch(() => setError(true));
  }, [productId]);

  return (
    <s-section heading="Why it isn't selling">
      {error && <s-banner tone="critical">Could not run the diagnosis.</s-banner>}
      {!error && !reasons && <s-spinner accessibilityLabel="Diagnosing" />}
      {reasons?.length === 0 && <s-paragraph>No problems found on this product's page, price or stock.</s-paragraph>}
      {reasons && reasons.length > 0 && (
        <ul className="m-0 list-none space-y-3 p-0">
          {reasons.map((r) => (
            <li key={r.code} className="flex flex-col gap-1">
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-badge tone={TONE[r.severity]}>{r.severity}</s-badge>
                <span className="font-medium">{TITLES[r.code] ?? r.code}</span>
              </s-stack>
              <span className="text-sm text-zinc-700">
                {r.evidence}{" "}
                <a href={r.link} className="text-zinc-500 underline">
                  See the data
                </a>
              </span>
            </li>
          ))}
        </ul>
      )}
    </s-section>
  );
}
