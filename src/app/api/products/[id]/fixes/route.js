import { requireFeature, requireWithinLimit } from "@/lib/feature-gate";
import { applyFix } from "@/lib/fix-center";
import { validateFix } from "@/lib/fixes";
import { appRoute, readJson } from "@/lib/route";

// Body: { type, after, expected?, diagnosisId? } (`expected`: the state the page showed). The merchant's click is the approval; the fix is applied now.
export const POST = appRoute(async ({ request, shop, params }) => {
  const { id } = params;
  requireFeature(shop, "fixCenter");
  await requireWithinLimit(shop, id);
  const body = await readJson(request);
  const valid = validateFix(body?.type ?? "", body?.after);
  if (!valid.ok) return Response.json({ error: valid.error }, { status: 400 });
  if (body?.expected !== undefined && (typeof body.expected !== "object" || body.expected === null)) {
    return Response.json({ error: "expected must be an object" }, { status: 400 });
  }
  const fix = await applyFix(shop.id, id, valid.type, valid.after, { diagnosisId: body?.diagnosisId, expected: body?.expected });
  return Response.json(fix);
});
