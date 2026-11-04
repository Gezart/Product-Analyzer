import { Dashboard } from "./dashboard";
import { SyncProgress } from "./sync-progress";

// Catalog health (the owner's design). The first import's progress shows above it until it's done.
export default function Home() {
  return (
    <>
      <SyncProgress />
      <Dashboard />
    </>
  );
}
