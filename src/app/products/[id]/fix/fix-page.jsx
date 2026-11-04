"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "@/app/ui/kit";
import { useHashScroll } from "@/app/ui/use-hash-scroll";
import { FixCenter } from "../fix-center";

/** The product's Fix center on its own page (the product page's "Fix the page" and diagnosis buttons lead here). */
export function FixPage() {
  const { id } = useParams();
  const [title, setTitle] = useState(null);
  // A diagnosis button names its section (e.g. #description): scroll there once it has loaded.
  useHashScroll(title != null);
  return (
    <>
      <PageHeader
        back={{ href: `/products/${id}`, label: title ?? "Product" }}
        title={title ? `Fix center · ${title}` : "Fix center"}
        subtitle="Changes go straight to Shopify. Every change can be undone."
      />
      <FixCenter productId={id} onTitle={setTitle} />
    </>
  );
}
