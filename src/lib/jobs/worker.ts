import { stopJobs, tick } from "@/lib/jobs/runner";

const IDLE_MS = 5_000;
const TICK_MS = 50_000;

let started = false;

/** In-process worker loop for an always-on server (Fly.io). Enabled with JOBS_WORKER=true. */
export function startWorker() {
  if (started) return;
  started = true;
  let stopped = false;
  // On deploy/shutdown, hand the running job back so another machine can pick it up.
  process.once("SIGTERM", () => {
    stopped = true;
    stopJobs();
  });
  const loop = async () => {
    try {
      await tick(TICK_MS);
    } catch (error) {
      console.error("[jobs] tick failed", error);
    }
    if (!stopped) setTimeout(loop, IDLE_MS);
  };
  setTimeout(loop, IDLE_MS);
  console.log("[jobs] worker started");
}
