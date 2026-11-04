import { Suspense } from "react";
import { PageHeader } from "@/app/ui/kit";
import { CompareView } from "./compare-view";

// The picked products are read from the URL on the client (useSearchParams), so they stream in.
export default function ComparePage() {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Compare" subtitle="Why does one sell and the other not? The best value in each row is highlighted." />
          <p className="m-0 text-muted">Loading…</p>
        </>
      }
    >
      <CompareView />
    </Suspense>
  );
}
