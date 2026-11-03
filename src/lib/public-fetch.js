// Fetches a page from a competitor's site without ever reaching a private address. Every DNS answer is
// checked at connect time (so a name can't be pointed at the app's own network after a check), redirects
// are followed by hand and checked again, and one deadline covers the whole read (DNS, connect, redirects
// and body), so a slow site can't hold a request open. Relative imports only, so node:test can load it.

import { lookup as dnsLookup } from "node:dns";
import { request } from "node:https";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { isPublicAddress, normalizeLink } from "./public-address.js";

export const FETCH_TIMEOUT_MS = 10_000;
export const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const USER_AGENT = "Mozilla/5.0 (compatible; UnstuckPriceCheck/1.0)";
const HTML = "text/html,application/xhtml+xml,application/json;q=0.9";

/** A fetch failure with a message the merchant can read. */
export class PageFetchError extends Error {}

const tooSlow = () => new PageFetchError("The page took too long to answer.");
const stopped = () => new PageFetchError("The check was stopped.");

/** A `lookup` for node:https that refuses a name when any of its addresses isn't public. */
function safeLookup(resolve) {
  return (hostname, options, callback) => {
    resolve(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error);
      if (!addresses?.length || addresses.some((a) => !isPublicAddress(a.address))) {
        return callback(new PageFetchError("This address isn't on the public internet."));
      }
      if (options?.all) return callback(null, addresses);
      return callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

function decoder(encoding) {
  if (encoding === "gzip" || encoding === "x-gzip") return createGunzip();
  if (encoding === "br") return createBrotliDecompress();
  if (encoding === "deflate") return createInflate();
  return null;
}

function getOnce(url, { accept, deadline, signal, lookup, send }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(stopped());
    const remaining = deadline - Date.now();
    if (remaining <= 0) return reject(tooSlow());

    let req = null;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      // The connection is always closed: after a redirect or an error, a site could otherwise keep it open.
      req?.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(tooSlow()), remaining);
    const onAbort = () => finish(stopped());
    signal?.addEventListener("abort", onAbort, { once: true });

    req = send(
      url,
      {
        method: "GET",
        lookup,
        headers: { "user-agent": USER_AGENT, accept, "accept-encoding": "gzip, deflate, br", "accept-language": "en" },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return finish(null, { redirect: res.headers.location });
        }
        if (res.statusCode !== 200) {
          return finish(new PageFetchError(res.statusCode === 404 ? "The page wasn't found (404)." : `The site answered with an error (${res.statusCode}).`));
        }
        if (Number(res.headers["content-length"] ?? 0) > MAX_BYTES) return finish(new PageFetchError("The page is too large to read."));
        const unzip = decoder(String(res.headers["content-encoding"] ?? "").toLowerCase());
        const body = unzip ? res.pipe(unzip) : res;
        const chunks = [];
        let size = 0;
        body.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            finish(new PageFetchError("The page is too large to read."));
            return body.destroy();
          }
          chunks.push(chunk);
        });
        body.on("end", () => finish(null, { body: Buffer.concat(chunks).toString("utf8"), type: String(res.headers["content-type"] ?? "") }));
        body.on("error", () => finish(new PageFetchError("The page couldn't be read.")));
        res.on("aborted", () => finish(new PageFetchError("The page couldn't be read.")));
      },
    );
    req.on("error", (error) => {
      if (error instanceof PageFetchError) return finish(error);
      if (error.cause instanceof PageFetchError) return finish(error.cause);
      finish(new PageFetchError(error.code === "ENOTFOUND" ? "This web address doesn't exist." : "The site couldn't be reached."));
    });
    req.end();
  });
}

/**
 * A page fetcher. `resolve` (a `dns.lookup`-style function) and `send` (an `https.request`-style
 * function) are replaceable for tests; every address `resolve` returns is still checked.
 */
export function createPageFetcher({ resolve = dnsLookup, send = request } = {}) {
  const lookup = safeLookup(resolve);
  /**
   * GET a public https page. Follows up to 3 redirects, each one checked like the original link.
   * `deadline` (ms timestamp, default 10 s from now) covers everything; `signal` stops the read.
   * Resolves `{ url, body, type }`; rejects with `PageFetchError`.
   */
  return async function fetchPublicPage(link, { accept = HTML, deadline = Date.now() + FETCH_TIMEOUT_MS, signal } = {}) {
    let current = link;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const checked = normalizeLink(current);
      if (checked.error) throw new PageFetchError(checked.error);
      const answer = await getOnce(checked.url, { accept, deadline, signal, lookup, send });
      if (!answer.redirect) return { url: checked.url, body: answer.body, type: answer.type };
      current = new URL(answer.redirect, checked.url).toString();
    }
    throw new PageFetchError("The link redirects too many times.");
  };
}

export const fetchPublicPage = createPageFetcher();
