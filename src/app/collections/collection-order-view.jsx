"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { UpgradeBanner } from "@/app/upgrade-banner";
import { CollectionOrderEditor } from "./collection-order-editor";

const numericId = (gid) => String(gid).split("/").pop();

/**
 * Collection Optimizer: pick a manually sorted collection, see the order the app proposes (with the
 * reason for each product), change it and save it to Shopify. The picked collection lives in the URL (`?c=<id>`).
 */
export function CollectionOrderView() {
  const router = useRouter();
  const params = useSearchParams();
  const picked = params.get("c") ?? "";
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [upgrade, setUpgrade] = useState(null);

  useEffect(() => {
    fetch("/api/collection-order")
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (res.status === 403 && body.upgrade) return setUpgrade(body.error);
        if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`);
        setList(body);
      })
      .catch((e) => setError(e.message));
  }, []);

  const showUpgrade = useCallback((text) => setUpgrade(text), []);

  return (
    <s-page heading="Collection order">
      <s-section>
        <s-stack gap="base">
          <s-text>
            Puts the products that sell, and the ones that deserve to be seen, where shoppers look first. Only collections sorted
            &quot;Manually&quot; in Shopify can be reordered.
          </s-text>
          {upgrade && <UpgradeBanner>{upgrade}</UpgradeBanner>}
          {error && <s-banner tone="critical">{error}</s-banner>}
          {!list && !upgrade && !error && <s-spinner accessibilityLabel="Loading collections" />}
          {list && list.collections.length === 0 && (
            <s-banner tone="info">
              No collection is sorted manually. In Shopify, open a collection and set &quot;Sort&quot; to &quot;Manually&quot; to reorder it here.
            </s-banner>
          )}
          {list && list.collections.length > 0 && (
            <label className="flex flex-col gap-1 text-sm">
              <span>Collection</span>
              <select
                className="max-w-md rounded-lg border border-zinc-300 px-3 py-2"
                value={picked}
                onChange={(e) => router.replace(e.target.value ? `/collections?c=${e.target.value}` : "/collections")}
              >
                <option value="">Choose a collection…</option>
                {list.collections.map((c) => (
                  <option key={c.id} value={numericId(c.id)} disabled={c.tooLarge}>
                    {c.title} ({c.count.toLocaleString()}){c.tooLarge ? ": too many products to reorder here" : ""}
                  </option>
                ))}
              </select>
              {list.truncated && <span className="text-zinc-500">Only the first 2,500 collections are listed.</span>}
              {list.automatic > 0 && (
                <span className="text-zinc-500">
                  {list.automatic} other {list.automatic === 1 ? "collection is" : "collections are"} sorted automatically (best selling, price, date…) and
                  {list.automatic === 1 ? " isn't" : " aren't"} listed.
                </span>
              )}
            </label>
          )}
        </s-stack>
      </s-section>

      {picked && !upgrade && (
        <s-section heading="Proposed order">
          <CollectionOrderEditor key={picked} collectionId={picked} onUpgrade={showUpgrade} />
        </s-section>
      )}
    </s-page>
  );
}
