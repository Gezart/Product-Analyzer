import { cancelMarkdown } from "@/lib/markdown-engine";
import { appRoute } from "@/lib/route";

// Stops a running markdown and restores the original prices (where they're still the plan's).
export const POST = appRoute(async ({ shop, params }) => {
  const { planId } = params;
  await cancelMarkdown(shop.id, planId);
  return Response.json({ cancelled: true });
});
