import { Suspense } from "react";
import { ProductList } from "./product-list";

// The status filter is read from the URL on the client (useSearchParams), so it streams in.
export default function ProductsPage() {
  return (
    <Suspense fallback={<s-page heading="Products"><s-spinner accessibilityLabel="Loading products" /></s-page>}>
      <ProductList />
    </Suspense>
  );
}
