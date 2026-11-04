import { Suspense } from "react";
import { PageHeader } from "@/app/ui/kit";
import { FixPage } from "./fix-page";

// The product id is read on the client (useParams), so it streams in after prerendering.
export default function ProductFixPage() {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Fix center" />
          <p className="m-0 text-muted">Loading the fix center…</p>
        </>
      }
    >
      <FixPage />
    </Suspense>
  );
}
