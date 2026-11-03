import { discardPhotoDraft } from "@/lib/ai/photos";
import { appRoute } from "@/lib/route";

// The merchant doesn't want this AI photo.
export const DELETE = appRoute(async ({ shop, params }) => Response.json(await discardPhotoDraft(shop, params.draftId)));
