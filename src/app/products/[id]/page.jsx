import { Suspense } from "react";
import { PageHeader } from "@/app/ui/kit";
import { ProductView } from "./product-view";

// The product id is read on the client (useParams), so it streams in after prerendering.
export default function ProductPage() {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader back={{ href: "/products", label: "Products" }} title="Product" />
          <p className="m-0 text-muted">Loading product…</p>
        </>
      }
    >
      <ProductView />
    </Suspense>
  );
}
