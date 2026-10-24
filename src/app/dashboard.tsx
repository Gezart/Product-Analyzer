"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type StatusSummary = { status: string; count: number; stockValue: number; moneyAtStake: number };
type TopRow = { productId: string; title: string; status: string; moneyAtStake: number; daysOfCover: number | null; sellThrough: number | null };
type Dashboard = {
  currency: string;
  scoredAt: string | null;
  moneyStuck: number;
  moneyStuckIsEstimate: boolean;
  productCount: number;
  byStatus: StatusSummary[];
  top: TopRow[];
};

// Labels and next actions from docs/PLAN.md → Product statuses.
export const STATUS_INFO: Record<string, { label: string; action: string; tone: string }> = {
  dead_stock: { label: "Dead stock", action: "Short rescue plan, then markdown", tone: "critical" },
  slow_mover: { label: "Slow mover", action: "Diagnose, then rescue plan", tone: "warning" },
  page_problem: { label: "Page problem", action: "Fix the product page", tone: "warning" },
  hidden_gem: { label: "Hidden gem", action: "Raise visibility", tone: "info" },
  stockout_risk: { label: "Stock-out risk", action: "Reorder", tone: "attention" },
  healthy: { label: "Healthy", action: "Nothing to do", tone: "success" },
};

export function Dashboard() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/dashboard")
      .then(async (res) => (res.ok ? setData(await res.json()) : Promise.reject(new Error(`${res.status}`))))
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <s-banner tone="critical">Could not load the dashboard ({error}).</s-banner>;
  if (!data) return <s-spinner accessibilityLabel="Loading dashboard" />;
  if (data.productCount === 0) {
    return (
      <s-section>
        <s-paragraph>Your dashboard appears here as soon as the first analysis of your store is finished.</s-paragraph>
      </s-section>
    );
  }

  const money = new Intl.NumberFormat(undefined, { style: "currency", currency: data.currency, maximumFractionDigits: 0 });

  return (
    <s-stack gap="base">
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

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {data.byStatus.map((s) => (
          <s-box key={s.status} padding="base" background="subdued" borderRadius="base">
            <s-stack gap="small-200">
              <s-badge tone={STATUS_INFO[s.status]?.tone}>{STATUS_INFO[s.status]?.label ?? s.status}</s-badge>
              <div className="text-2xl font-semibold">{s.count}</div>
              <s-text tone="neutral">{money.format(s.stockValue)} in stock</s-text>
            </s-stack>
          </s-box>
        ))}
      </div>

      <s-section heading="Top 10 to act on today">
        {data.top.length === 0 ? (
          <s-paragraph>Nothing needs attention right now.</s-paragraph>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
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
                    <td className="py-2 text-right">{r.daysOfCover == null ? "—" : Math.round(r.daysOfCover)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <s-text tone="neutral">Money at stake = stock value × status weight (dead stock 100%, slow 70%, page problem 60%, hidden gem 40%).</s-text>
      </s-section>
      {data.scoredAt && <s-text tone="neutral">Last analyzed {new Date(data.scoredAt).toLocaleString()}.</s-text>}
    </s-stack>
  );
}
