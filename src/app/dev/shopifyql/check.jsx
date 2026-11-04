"use client";

import { useEffect, useState } from "react";
import { apiError } from "@/app/api-error";
import { CARD, H2, Notice, PageHeader } from "@/app/ui/kit";

/** What ShopifyQL returns for product views on this store (copy the result to the developer). */
export function ShopifyqlCheck() {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    fetch("/api/dev/shopifyql")
      .then(async (res) => (res.ok ? setResult(await res.json()) : Promise.reject(await apiError(res))))
      .catch((e) => setError(e.message));
  }, []);
  const best = result?.results.find((r) => r.ok && r.viewRows > 0);

  return (
    <>
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="ShopifyQL check" subtitle="What ShopifyQL returns for product views on this store." />
      {error && <Notice tone="bad">{error}</Notice>}
      {!result && !error && <p className="m-0 text-muted">Running ShopifyQL queries…</p>}
      {result && (
        <>
          <Notice tone={best ? "good" : "warn"}>
            {best
              ? `Views work: query “${best.id}” returned ${best.viewRows} daily rows for ${best.products} products (${best.from} → ${best.to}).`
              : "No query returned views yet. Copy the result below and send it to the developer."}
          </Notice>
          <section aria-labelledby="result" className={`${CARD} flex flex-col gap-2 px-5 py-[18px]`}>
            <h2 id="result" className={H2}>
              Result (copy all of it)
            </h2>
            <pre className="m-0 max-h-[70vh] overflow-auto rounded-lg bg-head p-3 text-xs break-all whitespace-pre-wrap">{JSON.stringify(result, null, 2)}</pre>
          </section>
        </>
      )}
    </>
  );
}
