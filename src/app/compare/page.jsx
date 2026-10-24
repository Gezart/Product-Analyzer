import { Suspense } from "react";
import { CompareView } from "./compare-view";

// The picked products are read from the URL on the client (useSearchParams), so they stream in.
export default function ComparePage() {
  return (
    <Suspense fallback={<s-page heading="Compare products"><s-spinner accessibilityLabel="Loading" /></s-page>}>
      <CompareView />
    </Suspense>
  );
}
