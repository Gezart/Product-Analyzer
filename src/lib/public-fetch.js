// Fetches a page from a competitor's site without ever reaching a private address. Every DNS answer is
// checked at connect time (so a name can't be pointed at the app's own network after a check), redirects
// are followed by hand and checked again, and the time and size of each answer are capped.

import { lookup as dnsLookup } from "node:dns";
import { request } from "node:https";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { isPublicAddress, normalizeLink } from "@/lib/public-address";

export const FETCH_TIMEOUT_MS = 10_000;
export const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const USER_AGENT = "Mozilla/5.0 (compatible; UnstuckPriceCheck/1.0)";

/** A fetch failure with a message the merchant can read. */
export class PageFetchError extends Error {}

function safeLookup(hostname, options, callback) {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) {
      return callback(new PageFetchError("This address isn't on the public internet."));
    }
    if (options?.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

function decoder(encoding) {
  if (encoding === "gzip" || encoding === "x-gzip") return createGunzip();
  if (encoding === "br") return createBrotliDecompress();
  if (encoding === "deflate") return createInflate();
  return null;
}

function getOnce(url, accept, deadline) {
  return new Promise((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return reject(new PageFetchError("The page took too long to answer."));
    const req = request(
      url,
      {
        method: "GET",
        lookup: safeLookup,
        headers: { "user-agent": USER_AGENT, accept, "accept-encoding": "gzip, deflate, br", "accept-language": "en" },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve({ redirect: res.headers.location });
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new PageFetchError(res.statusCode === 404 ? "The page wasn't found (404)." : `The site answered with an error (${res.statusCode}).`));
        }
        const length = Number(res.headers["content-length"] ?? 0);
        if (length > MAX_BYTES) {
          res.destroy();
          return reject(new PageFetchError("The page is too large to read."));
        }
        const unzip = decoder(String(res.headers["content-encoding"] ?? "").toLowerCase());
        const body = unzip ? res.pipe(unzip) : res;
        const chunks = [];
        let size = 0;
        body.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            body.destroy();
            res.destroy();
            reject(new PageFetchError("The page is too large to read."));
            return;
          }
          chunks.push(chunk);
        });
        body.on("end", () => resolve({ body: Buffer.concat(chunks).toString("utf8"), type: String(res.headers["content-type"] ?? "") }));
        body.on("error", () => reject(new PageFetchError("The page couldn't be read.")));
      },
    );
    req.setTimeout(remaining, () => req.destroy(new PageFetchError("The page took too long to answer.")));
    req.on("error", (error) => {
      if (error instanceof PageFetchError) return reject(error);
      if (error.cause instanceof PageFetchError) return reject(error.cause);
      reject(new PageFetchError(error.code === "ENOTFOUND" ? "This web address doesn't exist." : "The site couldn't be reached."));
    });
    req.end();
  });
}

/**
 * GET a public https page. Follows up to 3 redirects, each one checked like the original link.
 * Resolves `{ url, body, type }`; rejects with `PageFetchError`.
 */
export async function fetchPublicPage(link, { accept = "text/html,application/xhtml+xml,application/json;q=0.9" } = {}) {
  const deadline = Date.now() + FETCH_TIMEOUT_MS;
  let current = link;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const checked = normalizeLink(current);
    if (checked.error) throw new PageFetchError(checked.error);
    const answer = await getOnce(checked.url, accept, deadline);
    if (!answer.redirect) return { url: checked.url, body: answer.body, type: answer.type };
    current = new URL(answer.redirect, checked.url).toString();
  }
  throw new PageFetchError("The link redirects too many times.");
}
