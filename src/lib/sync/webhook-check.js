// Per-shop webhook subscriptions point at the app URL they were registered with. When that URL changes
// (a new `shopify app dev` tunnel, a new host), Shopify keeps delivering to the old one and product and
// order changes stop arriving until the nightly re-subscribe. The first request per shop in each server
// process compares the address and, when it moved, re-subscribes right away (the job then re-reads the
// products changed meanwhile).

import { db } from "@/lib/db";
import { enqueue } from "@/lib/jobs/queue";
import { webhookAddress } from "@/lib/sync/webhooks";

/** shopId → address already checked by this process. */
const checked = new Map();

/** Never throws: a failed check must not fail the request (it is tried again on the next one). */
export async function checkWebhookAddress(shopId) {
  let address;
  try {
    address = webhookAddress();
  } catch {
    return;
  }
  if (checked.get(shopId) === address) return;
  checked.set(shopId, address);
  try {
    const state = await db().syncState.findUnique({
      where: { shopId_resource: { shopId, resource: "webhooks" } },
      select: { lastCursor: true },
    });
    if (state?.lastCursor === address) return;
    // Only a job due now counts: the nightly one is always queued for 3:00.
    const pending = await db().job.findFirst({
      where: {
        shopId,
        type: "register-webhooks",
        OR: [{ status: "running" }, { status: "queued", runAt: { lte: new Date() } }],
      },
      select: { id: true },
    });
    if (!pending) await enqueue({ type: "register-webhooks", shopId });
  } catch (error) {
    checked.delete(shopId);
    console.error("Webhook address check failed:", error instanceof Error ? error.message : error);
  }
}

/** For tests. */
export function resetWebhookChecks() {
  checked.clear();
}
