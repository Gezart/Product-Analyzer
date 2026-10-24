export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.JOBS_WORKER === "true") {
    const { startWorker } = await import("@/lib/jobs/worker");
    startWorker();
  }
}
