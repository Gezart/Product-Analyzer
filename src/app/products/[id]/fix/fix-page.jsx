"use client";

import { useParams } from "next/navigation";
import { FixCenter } from "../fix-center";

/** The product's Fix center on its own page (the product page's "Fix the page" and diagnosis buttons lead here). */
export function FixPage() {
  const { id } = useParams();
  return <FixCenter productId={id} />;
}
