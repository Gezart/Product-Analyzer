import { HttpResponseError, RequestedTokenType } from "@shopify/shopify-api";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/jobs/queue";
import { resetSyncSteps } from "@/lib/sync/store";
import { shopify } from "@/lib/shopify";
import { loadOfflineSession, storeSession } from "@/lib/session-storage";

// Refresh the access token this long before it expires.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export class AuthError extends Error {}

/**
 * Shopify refused a token refresh or exchange (revoked, expired or bad token). The request is
 * answered 401 like any auth failure, but it doesn't mean the app was uninstalled.
 */
export class TokenRefusedError extends AuthError {}

/**
 * Authenticates a request from the embedded app.
 * App Bridge adds `Authorization: Bearer <session token>` to same-origin fetches.
 * On first use for a shop, the session token is exchanged for an expiring offline token.
 */
export async function authenticate(request) {
  const header = request.headers.get("authorization");
  const sessionToken = header?.match(/^Bearer (.+)$/)?.[1];
  if (!sessionToken) throw new AuthError("Missing session token");

  let payload;
  try {
    payload = await shopify().session.decodeSessionToken(sessionToken);
  } catch {
    throw new AuthError("Invalid session token");
  }
  const shop = new URL(payload.dest).hostname;

  const session = await getOfflineSession(shop, sessionToken);
  return { shop: await markInstalled(shop), session };
}

/**
 * Creates or reactivates the shop row. Concurrent requests race on the database, not in code:
 * only the request whose insert or reactivation actually changed a row starts the initial import.
 */
async function markInstalled(domain) {
  const existing = await db().shop.findUnique({ where: { domain } });
  if (existing && !existing.uninstalledAt) return existing;

  const now = new Date();
  const created = await db().shop.createMany({ data: [{ domain, installedAt: now }], skipDuplicates: true });
  let isNewInstall = created.count === 1;
  if (!isNewInstall) {
    const reactivated = await db().shop.updateMany({
      where: { domain, uninstalledAt: { not: null } },
      data: { uninstalledAt: null, installedAt: now },
    });
    isNewInstall = reactivated.count === 1;
  }
  const shopRow = (await db().shop.findUnique({ where: { domain } }));
  if (isNewInstall) {
    await resetSyncSteps(shopRow.id);
    await enqueue({ type: "initial-sync", shopId: shopRow.id, uniqueKey: `initial-sync:${shopRow.id}:${now.getTime()}` });
  }
  return shopRow;
}

const RESCOPE_EVERY_MS = 10 * 60_000;

const refused = (error) => error instanceof HttpResponseError && [400, 401, 403].includes(error.response?.code);

/** Shopify refusing a token refresh or exchange means: authenticate again. */
function asAuthError(error) {
  if (refused(error)) throw new TokenRefusedError(`Shopify refused the token: ${error.message}`);
  throw error;
}
const lastRescope = new Map();

/** Returns a valid offline session, refreshing or exchanging the token when needed. */
export async function getOfflineSession(shop, sessionToken) {
  const existing = await loadOfflineSession(shop);
  // The app asks for a new scope (e.g. read_reports): once the merchant approves it, a new token
  // carries it. Re-exchanged at most every 10 minutes per shop while it's still missing.
  const rescope =
    Boolean(sessionToken && existing?.scope && existing.isScopeChanged(shopify().config.scopes)) &&
    Date.now() - (lastRescope.get(shop) ?? 0) > RESCOPE_EVERY_MS;

  if (existing?.accessToken && !existing.isExpired(REFRESH_MARGIN_MS) && !rescope) return existing;

  const refreshUsable =
    !rescope &&
    existing?.refreshToken &&
    (!existing.refreshTokenExpires || existing.refreshTokenExpires.getTime() > Date.now());

  if (refreshUsable) {
    try {
      const { session } = await shopify().auth.refreshToken({ shop, refreshToken: existing.refreshToken });
      await storeSession(session);
      return session;
    } catch (error) {
      // A refused refresh (e.g. another request refreshed first) falls back to a token exchange when
      // the request carries a session token; otherwise it's an auth failure.
      if (!refused(error) || !sessionToken) asAuthError(error);
    }
  }

  if (!sessionToken) throw new AuthError(`No usable offline token for ${shop}`);

  if (rescope) lastRescope.set(shop, Date.now());
  let session;
  try {
    ({ session } = await shopify().auth.tokenExchange({
      shop,
      sessionToken,
      requestedTokenType: RequestedTokenType.OfflineAccessToken,
      expiring: true,
    }));
  } catch (error) {
    // Only trying to pick up a new scope: the stored token still works, so keep using it.
    if (rescope && existing?.accessToken && !existing.isExpired(REFRESH_MARGIN_MS)) return existing;
    asAuthError(error);
  }
  await storeSession(session);
  return session;
}
