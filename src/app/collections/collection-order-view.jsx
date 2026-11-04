"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CARD, H2, Notice, PageHeader, UpgradeNotice } from "@/app/ui/kit";
import { collectionState } from "@/lib/collections-page";
import { CollectionOrderEditor } from "./collection-order-editor";

const numericId = (gid) => String(gid).split("/").pop();
const STATE_TONES = { accent: "text-accent", good: "text-[#047857]", warn: "text-[#B45309]", bad: "text-[#B91C1C]", muted: "text-muted" };
const products = (n) => (n == null ? "" : `${n.toLocaleString()} product${n === 1 ? "" : "s"}`);

/**
 * Collection Optimizer (the owner's design): the collections on the left with their state, the order
 * the app proposes for the picked one on the right (`?c=<id>` in the URL), confirmed and written to Shopify.
 */
export function CollectionOrderView() {
  const router = useRouter();
  const params = useSearchParams();
  const picked = params.get("c") ?? "";
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [upgrade, setUpgrade] = useState(null);

  const loadList = useCallback(async () => {
    const res = await fetch("/api/collection-order").catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) return setError(body.error ?? `Failed (${res?.status ?? "network"})`);
    // On a plan without the optimizer: only collections with saved orders, to undo them.
    if (body.upgrade) setUpgrade(body.error);
    setError(null);
    setList(body);
  }, []);
  useEffect(() => {
    loadList();
  }, [loadList]);

  const showUpgrade = useCallback((text) => setUpgrade(text), []);
  // The page doesn't jump to the top; on a phone the editor scrolls itself into view.
  const pick = (id) => router.replace(id ? `/collections?c=${id}` : "/collections", { scroll: false });
  const choosable = (list?.collections ?? []).filter((c) => !c.tooLarge);
  // "Skip": on to the next collection that can be reordered (after the last, back to the first).
  const skip = () => {
    const i = choosable.findIndex((c) => numericId(c.id) === picked);
    const next = choosable[(i + 1) % choosable.length];
    pick(numericId(next.id));
  };

  return (
    <>
      <PageHeader title="Collection Optimizer" subtitle="The app proposes a better order for each collection. You confirm, then it writes the order to Shopify." />
      {upgrade && <UpgradeNotice>{upgrade}</UpgradeNotice>}
      {error && <Notice tone="bad">{error}</Notice>}
      {!list && !error && <p className="m-0 text-muted">Loading collections…</p>}
      {list && (
        // The list beside the proposal, with the saved orders right under the proposal (however long the list).
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(240px,1fr)_minmax(0,2.6fr)] lg:grid-rows-[auto_1fr]">
          <section aria-labelledby="cols" className={`${CARD} flex min-w-0 flex-col gap-1 p-3.5 lg:row-span-2`}>
            <h2 id="cols" className={`${H2} mx-1.5 mb-1.5`}>
              Collections
            </h2>
            {list.collections.length === 0 && (
              <p className="m-0 px-1.5 text-[13px] text-muted">
                {upgrade ? "No saved orders to undo." : "No collection is sorted manually. In Shopify, open a collection and set “Sort” to “Manually” to reorder it here."}
              </p>
            )}
            {list.collections.map((c) => {
              const id = numericId(c.id);
              const state = collectionState(c);
              const on = id === picked;
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  disabled={c.tooLarge}
                  onClick={() => pick(id)}
                  className={`w-full cursor-pointer rounded-lg border px-2.5 py-[9px] text-left font-[inherit] text-ink disabled:cursor-default ${on ? "border-accent-line bg-accent-soft" : "border-transparent bg-white hover:bg-head"}`}
                >
                  <span className="flex justify-between gap-2">
                    <span className="min-w-0 font-semibold [overflow-wrap:anywhere]">{c.title}</span>
                    <span className="flex-none text-xs text-muted">{products(c.count)}</span>
                  </span>
                  <span className={`block text-xs font-semibold ${STATE_TONES[state.tone]}`}>{state.text}</span>
                </button>
              );
            })}
            {(list.automaticCollections ?? []).map((c) => (
              <div key={c.id} className="rounded-lg px-2.5 py-[9px]">
                <span className="flex justify-between gap-2">
                  <span className="min-w-0 font-semibold text-ink-2 [overflow-wrap:anywhere]">{c.title}</span>
                  <span className="flex-none text-xs text-muted">{products(c.count)}</span>
                </span>
                <span className="block text-xs font-semibold text-[#B45309]">Sorted automatically · switch to “Manually” in Shopify to optimize</span>
              </div>
            ))}
            {list.automatic > (list.automaticCollections ?? []).length && (
              <p className="m-0 px-2.5 pt-1 text-xs text-muted">
                {list.automatic - (list.automaticCollections ?? []).length} more{" "}
                {list.automatic - (list.automaticCollections ?? []).length === 1 ? "collection is" : "collections are"} sorted automatically.
              </p>
            )}
            {list.truncated && <p className="m-0 px-2.5 pt-1 text-xs text-muted">Only the first 2,500 collections are listed.</p>}
          </section>

          {picked ? (
            <CollectionOrderEditor key={picked} collectionId={picked} onUpgrade={showUpgrade} onSkip={choosable.length > 1 ? skip : null} onChanged={loadList} />
          ) : (
            list.collections.length > 0 && (
              <section className={`${CARD} min-w-0 px-5 py-[18px]`}>
                <p className="m-0 text-[13px] text-muted">
                  {upgrade
                    ? "Pick a collection to see its saved orders and undo them."
                    : "Pick a collection to see the order the app proposes: best sellers first, then hidden gems and products that need sales, sold-out products last."}
                </p>
              </section>
            )
          )}
        </div>
      )}
    </>
  );
}
