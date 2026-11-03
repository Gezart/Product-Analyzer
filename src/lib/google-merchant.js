// Google Merchant Center: connecting a shop (OAuth, account choice), and reading Google's price benchmark
// for its products every night. Endpoints and fields follow the Merchant API discovery documents
// (accounts_v1, reports_v1). The refresh token is stored encrypted; access tokens are never stored.

import { randomBytes } from "node:crypto";
import { decrypt, encrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import {
  BENCHMARK_QUERY,
  benchmarkRows,
  GOOGLE_REVOKE_URL,
  GOOGLE_SCOPE,
  GOOGLE_TOKEN_URL,
  googleAuthUrl,
  MERCHANT_API,
  isFresh,
  parseOfferId,
  productBenchmark,
} from "@/lib/google-benchmark";
import { HttpError } from "@/lib/http-error";
import { enqueue } from "@/lib/jobs/queue";
import { hasFeature } from "@/lib/plans";

const TIMEOUT_MS = 30_000;
const STATE_TTL_MS = 10 * 60 * 1000;
const MAX_REPORT_PAGES = 50; // 1,000 rows each
const MAX_AMOUNT = 1e9; // fits Decimal(12, 2)
const MAX_ACCOUNT_PAGES = 4; // 250 accounts each

/** A Google failure with a message the merchant can read; `reconnect` when only a new consent helps. */
export class GoogleError extends Error {
  constructor(message, { reconnect = false } = {}) {
    super(message);
    this.reconnect = reconnect;
  }
}

/** The app owner has set up a Google OAuth client (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET). */
export function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

const redirectUri = () => new URL("/api/google/callback", env.appUrl).toString();

async function call(url, { method = "GET", form, json, token, signal } = {}) {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
        ...(json ? { "content-type": "application/json" } : {}),
      },
      body: form ? new URLSearchParams(form) : json ? JSON.stringify(json) : undefined,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new GoogleError("Google couldn't be reached. It will be tried again tonight.");
  }
  const body = await res.json().catch(() => ({}));
  if (res.ok) return body;
  if (body?.error === "invalid_grant") throw new GoogleError("Google access was removed or expired. Connect again.", { reconnect: true });
  if (res.status === 401) throw new GoogleError("Google didn't accept the access. Connect again.", { reconnect: true });
  if (res.status === 403) throw new GoogleError("This Google account can't read the Merchant Center account. Check its access in Merchant Center, or connect another account.");
  if (res.status === 404) throw new GoogleError("The Merchant Center account wasn't found. Choose the account again.");
  console.error("[google]", method, url.split("?")[0], res.status, JSON.stringify(body).slice(0, 500));
  throw new GoogleError(`Google answered with an error (${res.status}). It will be tried again tonight.`);
}

/** A short-lived access token from the stored refresh token. */
async function accessToken(connection, signal) {
  if (!connection?.refreshToken) throw new GoogleError("Google isn't connected.", { reconnect: true });
  const body = await call(GOOGLE_TOKEN_URL, {
    method: "POST",
    form: { client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: decrypt(connection.refreshToken), grant_type: "refresh_token" },
    signal,
  });
  if (!body.access_token) throw new GoogleError("Google didn't give access. Connect again.", { reconnect: true });
  return body.access_token;
}

/** The Merchant Center accounts this Google user can open: `[{ accountId, accountName }]`. */
async function listAccounts(token) {
  const accounts = [];
  let pageToken = "";
  for (let page = 0; page < MAX_ACCOUNT_PAGES; page++) {
    const query = new URLSearchParams({ pageSize: "250", ...(pageToken ? { pageToken } : {}) });
    const body = await call(`${MERCHANT_API}/accounts/v1/accounts?${query}`, { token });
    for (const a of body.accounts ?? []) {
      const accountId = String(a.accountId ?? a.name?.split("/")[1] ?? "");
      if (accountId) accounts.push({ accountId, accountName: a.accountName ?? accountId });
    }
    pageToken = body.nextPageToken ?? "";
    if (!pageToken) break;
  }
  return accounts;
}

/**
 * Queues a read of the benchmarks now, unless one is already due (tomorrow's nightly read is always
 * waiting, so it doesn't count).
 */
async function queueSync(shopId) {
  const due = await db().job.findFirst({ where: { shopId, type: "google-benchmarks", status: "queued", runAt: { lte: new Date() } }, select: { id: true } });
  if (!due) await enqueue({ type: "google-benchmarks", shopId });
}

function requirePlan(shop) {
  if (!hasFeature(shop.plan, "marketPrice")) throw new HttpError("Market price is included from the Starter plan.", 403, { upgrade: "starter" });
  if (!googleConfigured()) throw new HttpError("Google Merchant Center isn't set up for this app yet.", 409);
}

/** Starts the consent screen: a single-use state for 10 minutes, and Google's link to open. */
export async function startConnect(shop) {
  requirePlan(shop);
  const state = randomBytes(24).toString("base64url");
  const stateExpiresAt = new Date(Date.now() + STATE_TTL_MS);
  await db().googleConnection.upsert({
    where: { shopId: shop.id },
    create: { shopId: shop.id, oauthState: state, stateExpiresAt },
    update: { oauthState: state, stateExpiresAt },
  });
  return googleAuthUrl({ clientId: process.env.GOOGLE_CLIENT_ID, redirectUri: redirectUri(), state });
}

/** Revokes a token Google just gave (best effort), when connecting doesn't finish. */
async function revoke(token) {
  try {
    await call(GOOGLE_REVOKE_URL, { method: "POST", form: { token } });
  } catch (error) {
    console.warn("[google] revoke failed", error.message);
  }
}

/**
 * The store a consent-screen answer belongs to, for the confirmation page (the merchant sees which
 * store is being connected before anything is stored). Throws `GoogleError` for an unknown or expired link.
 */
export async function callbackStore(state) {
  if (!state) throw new GoogleError("This link isn't valid. Start again from the app's Settings.");
  const connection = await db().googleConnection.findUnique({ where: { oauthState: String(state) }, select: { stateExpiresAt: true, shop: { select: { domain: true } } } });
  if (!connection) throw new GoogleError("This link was already used or isn't valid. Start again from the app's Settings.");
  if (!connection.stateExpiresAt || connection.stateExpiresAt < new Date()) throw new GoogleError("This link has expired. Start again from the app's Settings.");
  return connection.shop.domain;
}

/** Uses up a state (once, before it expires) and returns its shop; throws `GoogleError` otherwise. */
async function claimState(state) {
  if (!state) throw new GoogleError("This link isn't valid. Start again from the app's Settings.");
  const connection = await db().googleConnection.findUnique({ where: { oauthState: String(state) }, select: { shopId: true } });
  const { count } = connection
    ? await db().googleConnection.updateMany({ where: { shopId: connection.shopId, oauthState: String(state), stateExpiresAt: { gt: new Date() } }, data: { oauthState: null, stateExpiresAt: null } })
    : { count: 0 };
  if (count !== 1) throw new GoogleError("This link was already used or has expired. Start again from the app's Settings.");
  return connection.shopId;
}

/** Google said no (or the merchant cancelled): the link is used up and nothing changes. */
export async function cancelConnect(state, error) {
  await claimState(state);
  throw new GoogleError(error === "access_denied" ? "Access wasn't given, so nothing was connected." : "Google couldn't finish connecting. Try again.");
}

/**
 * The merchant confirmed connecting the store: the state is used once and the code becomes a stored
 * (encrypted) refresh token. With one Merchant Center account it is chosen; with several the merchant
 * chooses in Settings. Resolves `{ status }`; throws `GoogleError` with a readable message.
 */
export async function finishConnect({ state, code }) {
  const shopId = await claimState(state);
  if (!code) throw new GoogleError("Google didn't send a code. Try again.");
  if (!googleConfigured()) throw new GoogleError("Google Merchant Center isn't set up for this app yet.");

  const tokens = await call(GOOGLE_TOKEN_URL, {
    method: "POST",
    form: { code: String(code), client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri(), grant_type: "authorization_code" },
  });
  let accounts;
  try {
    if (!String(tokens.scope ?? "").split(" ").includes(GOOGLE_SCOPE)) throw new GoogleError("Access to Merchant Center wasn't given. Try again and allow it.");
    if (!tokens.refresh_token) throw new GoogleError("Google didn't give lasting access. Try again.");
    accounts = await listAccounts(tokens.access_token);
  } catch (error) {
    await revoke(tokens.refresh_token ?? tokens.access_token);
    throw error;
  }
  const only = accounts.length === 1 ? accounts[0] : null;
  const status = accounts.length === 0 ? "failed" : only ? "connected" : "choose_account";
  // Without a Merchant Center account the access is useless: it's given back, only the reason is kept.
  if (accounts.length === 0) await revoke(tokens.refresh_token);
  const { count } = await db().googleConnection.updateMany({
    where: { shopId },
    data: {
      refreshToken: accounts.length === 0 ? null : encrypt(tokens.refresh_token),
      status,
      accountId: only?.accountId ?? null,
      accountName: only?.accountName ?? null,
      error: accounts.length === 0 ? "This Google account has no Merchant Center account. Connect with the Google account that manages your Merchant Center." : null,
      syncedAt: null,
    },
  });
  if (count === 0) {
    // Disconnected (or uninstalled) while Google's window was open.
    await revoke(tokens.refresh_token);
    throw new GoogleError("Google was disconnected in the meantime. Start again from the app's Settings.");
  }
  await db().googleBenchmark.deleteMany({ where: { shopId } });
  if (only) await queueSync(shopId);
  return { status };
}

/** Settings: the connection, and the accounts to choose from when there are several. */
export async function googleOverview(shop) {
  const base = { configured: googleConfigured(), upgrade: hasFeature(shop.plan, "marketPrice") ? null : "starter" };
  const c = await db().googleConnection.findUnique({ where: { shopId: shop.id } });
  if (!c?.refreshToken) return { ...base, status: "not_connected", error: c?.error ?? null };
  const benchmarks = await db().googleBenchmark.count({ where: { shopId: shop.id } });
  const overview = { ...base, status: c.status, accountId: c.accountId, accountName: c.accountName, error: c.error, syncedAt: c.syncedAt, benchmarks };
  if (c.status !== "choose_account" || !base.configured) return overview;
  try {
    return { ...overview, accounts: await listAccounts(await accessToken(c)) };
  } catch (error) {
    if (!(error instanceof GoogleError)) throw error;
    return { ...overview, accounts: [], error: error.message };
  }
}

/** Chooses the Merchant Center account to read (one the connected Google user can open). */
export async function chooseAccount(shop, accountId) {
  requirePlan(shop);
  const c = await db().googleConnection.findUnique({ where: { shopId: shop.id } });
  if (!c?.refreshToken) throw new HttpError("Connect Google Merchant Center first.", 409);
  let accounts;
  try {
    accounts = await listAccounts(await accessToken(c));
  } catch (error) {
    if (error instanceof GoogleError) throw new HttpError(error.message, 502);
    throw error;
  }
  const account = accounts.find((a) => a.accountId === String(accountId ?? ""));
  if (!account) throw new HttpError("Choose one of the listed accounts.", 400);
  await db().googleConnection.update({ where: { shopId: shop.id }, data: { accountId: account.accountId, accountName: account.accountName, status: "connected", error: null, syncedAt: null } });
  await db().googleBenchmark.deleteMany({ where: { shopId: shop.id } });
  await queueSync(shop.id);
}

/** Queues a read of the benchmarks now (the button in Settings). */
export async function syncNow(shop) {
  requirePlan(shop);
  const c = await db().googleConnection.findUnique({ where: { shopId: shop.id }, select: { status: true } });
  if (c?.status !== "connected") throw new HttpError("Connect Google Merchant Center first.", 409);
  await queueSync(shop.id);
}

/**
 * Removes the connection and its benchmarks; Google's access is revoked too (best effort). Also on
 * uninstall and shop deletion, and below the plan (a merchant can always take the access back).
 * `wait: false` (webhooks, which must answer within seconds) doesn't wait for Google.
 */
export async function disconnect(shop, { wait = true } = {}) {
  const c = await db().googleConnection.findUnique({ where: { shopId: shop.id } });
  if (c?.refreshToken) {
    const revoking = revoke(decrypt(c.refreshToken));
    if (wait) await revoking;
  }
  await db().googleBenchmark.deleteMany({ where: { shopId: shop.id } });
  await db().googleConnection.deleteMany({ where: { shopId: shop.id } });
}

/**
 * Nightly: Google's price competitiveness report for the chosen account, matched to the shop's
 * variants by offer ID (`shopify_<COUNTRY>_<productId>_<variantId>`); the stored benchmarks are replaced.
 * Skipped below the plan or when not connected. Returns how many benchmarks were stored.
 */
export async function syncBenchmarks(shopId, signal) {
  const shop = await db().shop.findUnique({ where: { id: shopId }, select: { id: true, plan: true, uninstalledAt: true } });
  const c = await db().googleConnection.findUnique({ where: { shopId } });
  if (!shop || shop.uninstalledAt || !hasFeature(shop.plan, "marketPrice") || !googleConfigured() || c?.status !== "connected" || !c.accountId) return 0;
  let rows = [];
  let pageToken = "";
  try {
    const token = await accessToken(c, signal);
    for (let page = 0; page < MAX_REPORT_PAGES && !signal?.aborted; page++) {
      const body = await call(`${MERCHANT_API}/reports/v1/accounts/${encodeURIComponent(c.accountId)}/reports:search`, {
        method: "POST",
        token,
        json: { query: BENCHMARK_QUERY, pageSize: 1000, ...(pageToken ? { pageToken } : {}) },
        signal,
      });
      rows.push(...benchmarkRows(body.results));
      pageToken = body.nextPageToken ?? "";
      if (!pageToken) break;
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    if (!(error instanceof GoogleError)) throw error;
    await db().googleConnection.updateMany({ where: { shopId }, data: { error: error.message, ...(error.reconnect ? { status: "failed" } : {}) } });
    return 0;
  }
  if (signal?.aborted) return 0;

  // Offer IDs → this shop's variants → products.
  const parsed = rows.map((r) => ({ ...r, ids: parseOfferId(r.offerId) })).filter((r) => r.ids);
  const variants = parsed.length
    ? await db().variant.findMany({
        where: { shopifyGid: { in: [...new Set(parsed.map((r) => r.ids.variantGid))] }, product: { shopId } },
        select: { shopifyGid: true, productId: true },
      })
    : [];
  const productOf = new Map(variants.map((v) => [v.shopifyGid, v.productId]));
  const data = parsed
    .filter((r) => productOf.has(r.ids.variantGid) && r.price < MAX_AMOUNT && r.benchmark < MAX_AMOUNT)
    .map((r) => ({ shopId, productId: productOf.get(r.ids.variantGid), offerId: r.offerId, country: r.country ?? r.ids.country, price: r.price, benchmark: r.benchmark, currency: r.currency }));
  // Stored only if the merchant didn't switch accounts or disconnect while the report was read.
  return db().$transaction(async (tx) => {
    const { count } = await tx.googleConnection.updateMany({
      where: { shopId, accountId: c.accountId, status: "connected" },
      data: { syncedAt: new Date(), error: pageToken ? `Only the first ${MAX_REPORT_PAGES * 1000} Google offers were read.` : null },
    });
    if (count === 0) return 0;
    await tx.googleBenchmark.deleteMany({ where: { shopId } });
    await tx.googleBenchmark.createMany({ data, skipDuplicates: true });
    return data.length;
  });
}

/** The shop's benchmarks are used only while connected and read in the last 3 days: the read date, or null. */
export async function googleIsFresh(shopId) {
  const c = await db().googleConnection.findUnique({ where: { shopId }, select: { status: true, syncedAt: true } });
  return isFresh(c?.status, c?.syncedAt) ? c.syncedAt : null;
}

/**
 * A product's Google benchmark in the shop's currency (`productBenchmark`, matched to the product's
 * price), with the read date; null below the plan, when not connected or when the last read is too old.
 */
export async function googleBenchmarkFor(shop, productId, price) {
  if (!shop.currency || !hasFeature(shop.plan, "marketPrice")) return null;
  const syncedAt = await googleIsFresh(shop.id);
  if (!syncedAt) return null;
  const rows = await db().googleBenchmark.findMany({ where: { shopId: shop.id, productId }, select: { price: true, benchmark: true, currency: true, country: true } });
  const found = productBenchmark(rows, shop.currency, price);
  return found && { ...found, syncedAt };
}
