import { RequestedTokenType, type Session } from "@shopify/shopify-api";
import { db } from "@/lib/db";
import { shopify } from "@/lib/shopify";
import { loadOfflineSession, storeSession } from "@/lib/session-storage";

// Refresh the access token this long before it expires.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export class AuthError extends Error {}

/**
 * Authenticates a request from the embedded app.
 * App Bridge adds `Authorization: Bearer <session token>` to same-origin fetches.
 * On first use for a shop, the session token is exchanged for an expiring offline token.
 */
export async function authenticate(request: Request) {
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
  const shopRow = await db().shop.upsert({
    where: { domain: shop },
    create: { domain: shop },
    update: { uninstalledAt: null },
  });

  return { shop: shopRow, session };
}

/** Returns a valid offline session, refreshing or exchanging the token when needed. */
export async function getOfflineSession(shop: string, sessionToken?: string): Promise<Session> {
  const existing = await loadOfflineSession(shop);

  if (existing?.accessToken && !existing.isExpired(REFRESH_MARGIN_MS)) return existing;

  const refreshUsable =
    existing?.refreshToken &&
    (!existing.refreshTokenExpires || existing.refreshTokenExpires.getTime() > Date.now());

  if (refreshUsable) {
    const { session } = await shopify().auth.refreshToken({
      shop,
      refreshToken: existing!.refreshToken!,
    });
    await storeSession(session);
    return session;
  }

  if (!sessionToken) throw new AuthError(`No usable offline token for ${shop}`);

  const { session } = await shopify().auth.tokenExchange({
    shop,
    sessionToken,
    requestedTokenType: RequestedTokenType.OfflineAccessToken,
    expiring: true,
  });
  await storeSession(session);
  return session;
}
