import { Suspense } from "react";
import { PageHeader } from "@/app/ui/kit";
import { CollectionOrderView } from "./collection-order-view";

// The picked collection is read from the URL on the client (useSearchParams), so it streams in.
export default function CollectionsPage() {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Collection Optimizer" subtitle="The app proposes a better order for each collection. You confirm, then it writes the order to Shopify." />
          <p className="m-0 text-muted">Loading collections…</p>
        </>
      }
    >
      <CollectionOrderView />
    </Suspense>
  );
}
