"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { UpgradeBanner } from "@/app/upgrade-banner";
import { moneyFormatter, STATUS_INFO } from "@/lib/status-info";

const numericId = (gid) => String(gid).split("/").pop();

/**
 * Collection Optimizer: pick a manually sorted collection and see the order the app proposes, with
 * the reason for each product. The picked collection lives in the URL (`?c=<id>`).
 */
export function CollectionOrderView() {
  const router = useRouter();
  const params = useSearchParams();
  const picked = params.get("c") ?? "";
  const [list, setList] = useState(null);
  const [data, setData] = useState(null);
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

  useEffect(() => {
    if (!picked) return;
    let live = true;
    setData(null);
    setError(null);
    fetch(`/api/collection-order/${encodeURIComponent(picked)}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`);
        if (live) setData(body);
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [picked]);

  const money = moneyFormatter(data?.currency);
  const moved = data ? data.proposal.filter((p) => p.from !== p.to).length : 0;

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

      {picked && !data && !error && (
        <s-section>
          <s-spinner accessibilityLabel="Loading the proposed order" />
        </s-section>
      )}
      {data && (
        <s-section heading={`Proposed order: ${data.collection.title}`}>
          <s-stack gap="base">
            <s-text tone="neutral">
              {moved === 0
                ? "The collection is already in the proposed order."
                : `Moves ${moved} of ${data.proposal.length} products. Bestsellers first, then hidden gems and products that need sales; page problems, out-of-season, sold-out and not-on-sale products last.`}
            </s-text>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-left text-sm">
                <thead className="text-zinc-500">
                  <tr>
                    <th className="py-1 pr-3 font-medium">New</th>
                    <th className="py-1 pr-3 font-medium">Now</th>
                    <th className="py-1 pr-3 font-medium">Product</th>
                    <th className="py-1 pr-3 font-medium">Status</th>
                    <th className="py-1 pr-3 text-right font-medium">Sales, 30 days</th>
                    <th className="py-1 font-medium">Why here</th>
                  </tr>
                </thead>
                <tbody>
                  {data.proposal.map((p) => {
                    const delta = p.from - p.to;
                    return (
                      <tr key={p.id} className="border-t border-zinc-100">
                        <td className="py-1.5 pr-3 tabular-nums">{p.to + 1}</td>
                        <td className="py-1.5 pr-3 tabular-nums text-zinc-500">
                          {p.from + 1}
                          {delta !== 0 && <span className={delta > 0 ? "ml-1 text-emerald-700" : "ml-1 text-zinc-400"}>{delta > 0 ? `↑${delta}` : `↓${-delta}`}</span>}
                        </td>
                        <td className="py-1.5 pr-3">{p.productId ? <Link href={`/products/${p.productId}`} className="underline">{p.title}</Link> : p.title}</td>
                        <td className="py-1.5 pr-3">{p.status ? <s-badge tone={STATUS_INFO[p.status]?.tone}>{STATUS_INFO[p.status]?.label ?? p.status}</s-badge> : <span className="text-zinc-400">—</span>}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{money.format(p.revenue30)}</td>
                        <td className="py-1.5 text-zinc-600">{p.reason}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}
