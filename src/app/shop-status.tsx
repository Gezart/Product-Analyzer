"use client";

import { useEffect, useState } from "react";

type ShopInfo = { domain: string; plan: string; installedAt: string };

// Calls the API through App Bridge's authenticated fetch to confirm install + token exchange work.
export function ShopStatus() {
  const [shop, setShop] = useState<ShopInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/shop")
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
        setShop(await res.json());
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p className="text-sm text-red-600">Not connected: {error}</p>;
  if (!shop) return <p className="text-sm text-zinc-500">Connecting to your store…</p>;
  return (
    <p className="text-sm text-zinc-600 dark:text-zinc-400">
      Connected to <span className="font-medium">{shop.domain}</span> · {shop.plan} plan
    </p>
  );
}
