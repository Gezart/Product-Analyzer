"use client";

import { useParams } from "next/navigation";
import { Markdown } from "../markdown";

/** The product's markdown on its own page (the product page's Markdown card leads here). */
export function MarkdownPage() {
  const { id } = useParams();
  return <Markdown productId={id} />;
}
