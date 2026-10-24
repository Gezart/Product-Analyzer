import { Dashboard } from "./dashboard";
import { SyncProgress } from "./sync-progress";

export default function Home() {
  return (
    <s-page heading="Catalog health">
      <s-stack gap="base">
        <SyncProgress />
        <Dashboard />
      </s-stack>
    </s-page>
  );
}
