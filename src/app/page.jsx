import { Dashboard } from "./dashboard";
import { InboxBanner } from "./inbox-banner";
import { SyncProgress } from "./sync-progress";

export default function Home() {
  return (
    <s-page heading="Catalog health">
      <s-stack gap="base">
        <SyncProgress />
        <InboxBanner />
        <Dashboard />
      </s-stack>
    </s-page>
  );
}
