import { Suspense } from "react";
import { ReportView } from "./report-view";

// The month is read from the URL on the client (useSearchParams), so it streams in.
export default function ReportsPage() {
  return (
    <Suspense fallback={<s-page heading="Monthly report"><s-spinner accessibilityLabel="Loading" /></s-page>}>
      <ReportView />
    </Suspense>
  );
}
