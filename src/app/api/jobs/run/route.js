import { createHash, timingSafeEqual } from "node:crypto";
import { tick } from "@/lib/jobs/runner";

export const maxDuration = 60;

const digest = (value) => createHash("sha256").update(value).digest();

function authorized(request) {
  const secret = process.env.CRON_SECRET;
  const match = request.headers.get("authorization")?.match(/^Bearer (.+)$/);
  if (!secret || !match) return false;
  // Equal-length digests, so the comparison never throws and leaks nothing about length.
  return timingSafeEqual(digest(match[1]), digest(secret));
}

// External cron trigger (alternative to the in-process worker): POST with `Authorization: Bearer $CRON_SECRET`.
export async function POST(request) {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
  return Response.json(await tick(50_000));
}
