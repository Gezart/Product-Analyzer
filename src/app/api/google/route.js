import { chooseAccount, disconnect, googleOverview, startConnect, syncNow } from "@/lib/google-merchant";
import { HttpError } from "@/lib/http-error";
import { appRoute, readJson } from "@/lib/route";

// Google Merchant Center in Settings: the connection and the accounts to choose from.
export const GET = appRoute(async ({ shop }) => Response.json(await googleOverview(shop)));

// Body: { action: "connect" } → { url } (Google's consent screen, opened in a new window);
// { action: "account", accountId }; { action: "sync" } (read the benchmarks now).
export const POST = appRoute(async ({ request, shop }) => {
  const body = await readJson(request);
  if (body?.action === "connect") return Response.json({ url: await startConnect(shop) });
  if (body?.action === "account") await chooseAccount(shop, body.accountId);
  else if (body?.action === "sync") await syncNow(shop);
  else throw new HttpError("Unknown action.", 400);
  return Response.json(await googleOverview(shop));
});

// Disconnects: Google's access is revoked and the benchmarks are removed.
export const DELETE = appRoute(async ({ shop }) => {
  await disconnect(shop);
  return Response.json(await googleOverview(shop));
});
