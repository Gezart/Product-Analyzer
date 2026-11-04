import { Suspense } from "react";
import { PageHeader } from "@/app/ui/kit";
import { ReportView } from "./report-view";

// The month is read from the URL on the client (useSearchParams), so it streams in.
export default function ReportsPage() {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Monthly report" subtitle="What Unstuck did for your store this month, with the formula under every number." />
          <p className="m-0 text-muted">Loading the report…</p>
        </>
      }
    >
      <ReportView />
    </Suspense>
  );
}
