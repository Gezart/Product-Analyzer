import { PageHeader } from "@/app/ui/kit";
import { PlanPicker } from "./plan-picker";

export default function PlansPage() {
  return (
    <>
      <PageHeader title="Plans" subtitle="Billed by Shopify. 14-day free trial on paid plans, once per store." />
      <PlanPicker />
    </>
  );
}
