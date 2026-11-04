import { Suspense } from "react";
import { PageHeader } from "@/app/ui/kit";
import { InboxPage } from "./inbox-page";

// The plan's week is read from the URL on the client (useSearchParams), so it streams in.
export default function Inbox() {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Inbox" subtitle="Your weekly plan and everything the app did or found." />
          <p className="m-0 text-muted">Loading the inbox…</p>
        </>
      }
    >
      <InboxPage />
    </Suspense>
  );
}
