import { Suspense } from "react";
import { CollectionOrderView } from "./collection-order-view";

// The picked collection is read from the URL on the client (useSearchParams), so it streams in.
export default function CollectionsPage() {
  return (
    <Suspense fallback={<s-page heading="Collection order"><s-spinner accessibilityLabel="Loading collections" /></s-page>}>
      <CollectionOrderView />
    </Suspense>
  );
}
