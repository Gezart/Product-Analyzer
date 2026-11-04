"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "@/app/ui/kit";
import { Markdown } from "../markdown";

/** The product's markdown ladder on its own page (the product page's Markdown card leads here). */
export function MarkdownPage() {
  const { id } = useParams();
  const [title, setTitle] = useState(null);
  return (
    <>
      <PageHeader back={{ href: `/products/${id}`, label: title ?? "Product" }} title={title ? `Markdown · ${title}` : "Markdown"} />
      <Markdown productId={id} onTitle={setTitle} />
    </>
  );
}
