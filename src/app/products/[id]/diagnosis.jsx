"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { UpgradeBanner } from "@/app/upgrade-banner";

const TITLES = {
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

const TONE = { high: "critical", medium: "warning", low: "info" };

/** "Why it isn't selling": rule-based reasons, each with its numbers and a link to the data. */
export function Diagnosis({ productId }) {
  const [reasons, setReasons] = useState(null);
  const [error, setError] = useState(false);
  const [upgrade, setUpgrade] = useState(null);

  useEffect(() => {
    fetch(`/api/products/${productId}/diagnosis`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (res.status === 403 && body.upgrade) return setUpgrade(body.error);
        if (!res.ok) throw new Error(String(res.status));
        setReasons(body.reasons);
      })
      .catch(() => setError(true));
  }, [productId]);

  return (
    <s-section heading="Why it isn't selling">
      {error && <s-banner tone="critical">Could not run the diagnosis.</s-banner>}
      {upgrade && <UpgradeBanner>{upgrade}</UpgradeBanner>}
      {!error && !upgrade && !reasons && <s-spinner accessibilityLabel="Diagnosing" />}
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
              <ReasonData reason={r} />
            </li>
          ))}
        </ul>
      )}
    </s-section>
  );
}

/** The items behind a reason that the linked section doesn't show by itself. */
function ReasonData({ reason }) {
  if (reason.code === "duplicate_description") {
    const ids = (reason.data.sameAs) ?? [];
    return (
      <span className="text-sm text-zinc-500">
        Same text as:{" "}
        {ids.map((id, i) => (
          <span key={id}>
            {i > 0 && ", "}
            <Link href={`/products/${id}`} className="underline">
              product {i + 1}
            </Link>
          </span>
        ))}
      </span>
    );
  }
  if (reason.code === "low_traffic_collections") {
    const views = (reason.data.collectionViews) ?? [];
    return <span className="text-sm text-zinc-500">Views per collection (30 days): {views.join(", ")}</span>;
  }
  return null;
}
