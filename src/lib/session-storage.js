import { Session } from "@shopify/shopify-api";
import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";

export async function storeSession(session) {
  const data = {
    shop: session.shop,
    state: session.state,
    isOnline: session.isOnline,
    scope: session.scope ?? null,
    accessToken: encrypt(session.accessToken),
    expires: session.expires ?? null,
    refreshToken: session.refreshToken ? encrypt(session.refreshToken) : null,
    refreshTokenExpires: session.refreshTokenExpires ?? null,
  };
  await db().session.upsert({
    where: { shop: session.shop },
    create: { id: session.id, ...data },
    update: { id: session.id, ...data },
  });
}

export async function loadOfflineSession(shop) {
  const row = await db().session.findUnique({ where: { shop } });
  if (!row) return undefined;
  return new Session({
    id: row.id,
    shop: row.shop,
    state: row.state,
    isOnline: row.isOnline,
    scope: row.scope ?? undefined,
    accessToken: decrypt(row.accessToken),
    expires: row.expires ?? undefined,
    refreshToken: row.refreshToken ? decrypt(row.refreshToken) : undefined,
    refreshTokenExpires: row.refreshTokenExpires ?? undefined,
  });
}

export async function deleteSessions(shop) {
  await db().session.deleteMany({ where: { shop } });
}
