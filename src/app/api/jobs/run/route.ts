import { timingSafeEqual } from "node:crypto";
import { tick } from "@/lib/jobs/runner";

export const maxDuration = 60;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || given.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(secret));
}

// External cron trigger (alternative to the in-process worker): POST with `Authorization: Bearer $CRON_SECRET`.
export async function POST(request: Request) {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
  return Response.json(await tick(50_000));
}
