"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/** What ShopifyQL returns for product views on this store (copy the result to the developer). */
export function ShopifyqlCheck() {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    fetch("/api/dev/shopifyql")
      .then(async (res) => (res.ok ? setResult(await res.json()) : Promise.reject(new Error(`${res.status} ${await res.text()}`))))
      .catch((e) => setError(e.message));
  }, []);
  const best = result?.results.find((r) => r.ok && r.viewRows > 0);

  return (
    <s-page heading="ShopifyQL check">
      <s-stack gap="base">
        <div>
          <Link href="/settings" className="text-sm text-zinc-600 hover:underline">
            ← Settings
          </Link>
        </div>
        {error && <s-banner tone="critical">{error}</s-banner>}
        {!result && !error && <s-spinner accessibilityLabel="Running ShopifyQL queries" />}
        {result && (
          <>
            <s-banner tone={best ? "success" : "warning"}>
              {best
                ? `Views work: query “${best.id}” returned ${best.viewRows} daily rows for ${best.products} products (${best.from} → ${best.to}).`
                : "No query returned views yet. Copy the result below and send it to the developer."}
            </s-banner>
            <s-section heading="Result (copy all of it)">
              <pre className="m-0 max-h-[70vh] overflow-auto whitespace-pre-wrap break-all rounded bg-zinc-50 p-3 text-xs">{JSON.stringify(result, null, 2)}</pre>
            </s-section>
          </>
        )}
      </s-stack>
    </s-page>
  );
}
