import { Suspense } from "react";
import { WeeklyPlanView } from "./weekly-plan-view";

// The week is read from the URL on the client (useSearchParams), so it streams in.
export default function PlanPage() {
  return (
    <Suspense fallback={<s-page heading="This week"><s-spinner accessibilityLabel="Loading the plan" /></s-page>}>
      <WeeklyPlanView />
    </Suspense>
  );
}
