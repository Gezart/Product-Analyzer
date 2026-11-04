import { Dashboard } from "./dashboard";
import { SyncProgress } from "./sync-progress";

// Catalog health (the owner's design). Until the first import is done, its progress shows instead.
export default function Home() {
  return (
    <SyncProgress>
      <Dashboard />
    </SyncProgress>
  );
}
