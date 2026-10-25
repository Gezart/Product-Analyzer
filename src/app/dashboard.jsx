"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { UpgradeBanner } from "@/app/upgrade-banner";
import { formatDays, moneyFormatter, STATUS_INFO } from "@/lib/status-info";

export function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  // Until the first analysis is finished, check again every few seconds so the dashboard appears by itself.
  useEffect(() => {
    let timer;
    const load = async () => {
      try {
        const res = await fetch("/api/dashboard");
        if (!res.ok) throw new Error(String(res.status));
        const body = await res.json();
        setData(body);
        setError(null);
        if (!body.imported) timer = setTimeout(load, 5000);
      } catch (e) {
        setError(e.message);
      }
    };
    load();
    return () => clearTimeout(timer);
  }, []);

  if (error) return <s-banner tone="critical">Could not load the dashboard ({error}).</s-banner>;
  if (!data) return <s-spinner accessibilityLabel="Loading dashboard" />;
  if (!data.imported) {
    return (
      <s-section>
        <s-paragraph>Your dashboard appears here as soon as the first analysis of your store is finished.</s-paragraph>
      </s-section>
    );
  }
  if (data.productCount === 0) {
    return (
      <s-section>
        <s-paragraph>
          No active products to analyze yet. Add products in Shopify (draft, archived and excluded products are left out, see Settings); new
          products are picked up at the next nightly analysis.
        </s-paragraph>
      </s-section>
    );
  }

  const money = moneyFormatter(data.currency);

  return (
    <s-stack gap="base">
      {data.overLimit > 0 && (
        <UpgradeBanner>
          {data.overLimit} more active product{data.overLimit === 1 ? " isn't" : "s aren't"} analyzed on your plan (the products with the most money
          in stock are analyzed first).
        </UpgradeBanner>
      )}
      <s-section>
        <s-stack gap="small">
          <s-text tone="neutral">Money stuck in stock</s-text>
          <div className="text-4xl font-semibold tracking-tight">{money.format(data.moneyStuck)}</div>
          <s-text tone="neutral">
            Stock value of dead stock and slow movers
            {data.moneyStuckIsEstimate ? " (estimated where product cost is missing: price × 50%)" : ""}.
          </s-text>
        </s-stack>
      </s-section>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {data.byStatus.map((s) => (
          <Link key={s.status} href={`/products?status=${s.status}`} className="rounded-lg hover:ring-2 hover:ring-zinc-300">
            <s-box padding="base" background="subdued" borderRadius="base">
              <s-stack gap="small-200">
                <s-badge tone={STATUS_INFO[s.status]?.tone}>{STATUS_INFO[s.status]?.label ?? s.status}</s-badge>
                <div className="text-2xl font-semibold">{s.count}</div>
                <s-text tone="neutral">{money.format(s.stockValue)} in stock</s-text>
              </s-stack>
            </s-box>
          </Link>
        ))}
      </div>

      <s-section heading="Top 10 to act on today">
        {data.top.length === 0 ? (
          <s-paragraph>Nothing needs attention right now.</s-paragraph>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead className="text-zinc-500">
                <tr>
                  <th className="py-2 pr-4 font-medium">Product</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Next action</th>
                  <th className="py-2 pr-4 text-right font-medium">Money at stake</th>
                  <th className="py-2 text-right font-medium">Days of stock</th>
                </tr>
              </thead>
              <tbody>
                {data.top.map((r) => (
                  <tr key={r.productId} className="border-t border-zinc-200">
                    <td className="py-2 pr-4">
                      <Link href={`/products/${r.productId}`} className="font-medium hover:underline">
                        {r.title}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">
                      <s-badge tone={STATUS_INFO[r.status]?.tone}>{STATUS_INFO[r.status]?.label ?? r.status}</s-badge>
                    </td>
                    <td className="py-2 pr-4">{STATUS_INFO[r.status]?.action}</td>
                    <td className="py-2 pr-4 text-right">{money.format(r.moneyAtStake)}</td>
                    <td className="py-2 text-right">{formatDays(r.daysOfCover)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <s-text tone="neutral">
          Money at stake = stock value × status weight (dead stock 100%, slow 70%, page problem 60%, hidden gem 40%).{" "}
          <Link href="/products" className="underline">
            See all products
          </Link>
        </s-text>
      </s-section>
      {data.scoredAt && <s-text tone="neutral">Last analyzed {new Date(data.scoredAt).toLocaleString()}.</s-text>}
    </s-stack>
  );
}
