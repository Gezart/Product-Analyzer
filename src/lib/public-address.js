// Which links and addresses the app may fetch from a competitor's site. Pure (node built-ins only) so
// node:test can load it. The rules keep a merchant-supplied link from reaching the app's own network.

import { isIP } from "node:net";

export const MAX_URL_LENGTH = 2000;

/** True for an IPv4 or IPv6 address on the public internet; false for private, local and reserved ranges. */
export function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) return isPublicV4(address);
  if (family === 6) return isPublicV6(address);
  return false;
}

function isPublicV4(address) {
  const [a, b, c] = address.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false; // this network, private, loopback, multicast + reserved
  if (a === 100 && b >= 64 && b <= 127) return false; // shared address space (carrier NAT)
  if (a === 169 && b === 254) return false; // link-local, including cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // IETF protocol assignments, documentation
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // documentation
  if (a === 203 && b === 0 && c === 113) return false; // documentation
  return true;
}

function expandV6(address) {
  const [head, tail = ""] = address.toLowerCase().split("::");
  const parts = (s) => (s ? s.split(":") : []);
  const toGroups = (list) =>
    list.flatMap((p) => {
      if (p.includes(".")) {
        const [a, b, c, d] = p.split(".").map(Number);
        return [((a << 8) | b).toString(16), ((c << 8) | d).toString(16)];
      }
      return [p];
    });
  const h = toGroups(parts(head));
  const t = toGroups(parts(tail));
  const missing = address.includes("::") ? 8 - h.length - t.length : 0;
  return [...h, ...Array(missing).fill("0"), ...t].map((g) => parseInt(g || "0", 16));
}

function isPublicV6(address) {
  const g = expandV6(address);
  if (g.every((x) => x === 0)) return false; // unspecified
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false; // loopback
  // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d) addresses follow the IPv4 rules.
  const v4 = `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isPublicV4(v4);
  if (g[0] === 0x64 && g[1] === 0xff9b) return isPublicV4(v4);
  if ((g[0] & 0xfe00) === 0xfc00) return false; // unique local
  if ((g[0] & 0xffc0) === 0xfe80) return false; // link-local
  if ((g[0] & 0xff00) === 0xff00) return false; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
  return true;
}

/**
 * A link a merchant may add: https only, the default port, a real host name (not a bare IP or a single
 * label like "localhost"), no user name or password. Returns `{ url, host }` with the fragment removed,
 * or `{ error }` with a message for the merchant.
 */
export function normalizeLink(input) {
  const text = String(input ?? "").trim();
  if (!text || text.length > MAX_URL_LENGTH) return { error: "Paste the full link to the product page." };
  let url;
  try {
    url = new URL(text);
  } catch {
    return { error: "This isn't a valid link. Paste the full address, starting with https://" };
  }
  if (url.protocol !== "https:") return { error: "Only secure links (https://) can be read." };
  if (url.username || url.password) return { error: "Links with a user name or password can't be read." };
  if (url.port && url.port !== "443") return { error: "Links with a custom port can't be read." };
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (isIP(host.replace(/^\[|\]$/g, "")) || !host.includes(".") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) {
    return { error: "Use the shop's web address, not an IP address or a local name." };
  }
  url.hash = "";
  return { url: url.toString(), host: host.replace(/^www\./, "") };
}
