import { recordRisingAction } from "@/lib/rising-actions";
import { appRoute, readJson } from "@/lib/route";

// The merchant did one of a rising star's suggested actions. Body: { kind: "collections" | "home" | "stock" }.
export const POST = appRoute(async ({ request, shop, params }) => {
  const body = await readJson(request);
  const action = await recordRisingAction(shop, params.id, String(body?.kind ?? ""));
  return Response.json({ id: action.id, kind: action.kind, startedOn: action.startedOn.toISOString().slice(0, 10) });
});
