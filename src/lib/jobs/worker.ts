import { tick } from "@/lib/jobs/runner";

const IDLE_MS = 5_000;
const TICK_MS = 50_000;

let started = false;

/** In-process worker loop for an always-on server (Fly.io). Enabled with JOBS_WORKER=true. */
export function startWorker() {
  if (started) return;
  started = true;
  const loop = async () => {
    try {
      await tick(TICK_MS);
    } catch (error) {
      console.error("[jobs] tick failed", error);
    }
    setTimeout(loop, IDLE_MS);
  };
  setTimeout(loop, IDLE_MS);
  console.log("[jobs] worker started");
}
