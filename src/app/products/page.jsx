import { Suspense } from "react";
import { PageHeader } from "@/app/ui/kit";
import { ProductList } from "./product-list";

// The status filter is read from the URL on the client (useSearchParams), so it streams in.
export default function ProductsPage() {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Products" />
          <p className="m-0 text-muted">Loading products…</p>
        </>
      }
    >
      <ProductList />
    </Suspense>
  );
}
