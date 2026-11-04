import { Suspense } from "react";
import { PageHeader } from "@/app/ui/kit";
import { MarkdownPage } from "./markdown-page";

// The product id is read on the client (useParams), so it streams in after prerendering.
export default function ProductMarkdownPage() {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Markdown" />
          <p className="m-0 text-muted">Loading the markdown…</p>
        </>
      }
    >
      <MarkdownPage />
    </Suspense>
  );
}
