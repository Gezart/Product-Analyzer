import { Suspense } from "react";
import { ProductView } from "./product-view";

// The product id is read on the client (useParams), so it streams in after prerendering.
export default function ProductPage() {
  return (
    <Suspense fallback={<s-page heading="Product"><s-spinner accessibilityLabel="Loading product" /></s-page>}>
      <ProductView />
    </Suspense>
  );
}
