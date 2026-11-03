import assert from "node:assert/strict";
import { test } from "node:test";
import { createPageFetcher } from "./public-fetch.js";

/** A fetcher whose DNS answers with `addresses` (or never answers, or fails with `code`). */
const fetcherWith = ({ addresses, hang = false, code } = {}) =>
  createPageFetcher({
    resolve: (hostname, options, callback) => {
      if (hang) return;
      if (code) return callback(Object.assign(new Error(code), { code }));
      setImmediate(() => callback(null, addresses));
    },
  });

test("a name that resolves to a private or cloud-metadata address is refused before connecting", async () => {
  for (const addresses of [
    [{ address: "127.0.0.1", family: 4 }],
    [{ address: "169.254.169.254", family: 4 }],
    [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.5", family: 4 }],
    [{ address: "::ffff:169.254.169.254", family: 6 }],
  ]) {
    await assert.rejects(fetcherWith({ addresses })("https://shop.example/p"), { message: "This address isn't on the public internet." }, JSON.stringify(addresses));
  }
});

test("one deadline covers the whole read, including a DNS lookup that never answers", async () => {
  const started = Date.now();
  await assert.rejects(fetcherWith({ hang: true })("https://shop.example/p", { deadline: Date.now() + 150 }), { message: "The page took too long to answer." });
  assert.ok(Date.now() - started < 2000, "stops at the deadline");
});

test("a stopped job stops the read", async () => {
  const controller = new AbortController();
  const read = fetcherWith({ hang: true })("https://shop.example/p", { signal: controller.signal });
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(read, { message: "The check was stopped." });
  await assert.rejects(fetcherWith({ hang: true })("https://shop.example/p", { signal: AbortSignal.abort() }), { message: "The check was stopped." });
});

test("unknown names and links that aren't allowed fail with readable messages", async () => {
  await assert.rejects(fetcherWith({ code: "ENOTFOUND" })("https://nope.example/p"), { message: "This web address doesn't exist." });
  await assert.rejects(fetcherWith({ code: "ECONNREFUSED" })("https://shop.example/p"), { message: "The site couldn't be reached." });
  await assert.rejects(fetcherWith({ addresses: [] })("http://shop.example/p"), { message: "Only secure links (https://) can be read." });
  await assert.rejects(fetcherWith({ addresses: [] })("https://localhost/p"), /IP address or a local name/);
});

// A local server stands in for a competitor's site: `send` connects to it over plain http, so the
// deadline, size cap, redirects and closed connections can be checked without the internet.
async function withSite(routes, run) {
  const { createServer } = await import("node:http");
  const sockets = new Set();
  const server = createServer((req, res) => (routes[req.url] ?? ((_, r) => r.writeHead(404).end()))(req, res));
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { request } = await import("node:http");
  const { port } = server.address();
  const fetchPage = createPageFetcher({
    send: (url, options, callback) => {
      const u = new URL(url);
      return request({ host: "127.0.0.1", port, path: u.pathname + u.search, method: "GET", headers: options.headers }, callback);
    },
  });
  try {
    await run(fetchPage, sockets);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
}

/** Waits up to 3 s for every connection to the local site to close. */
async function allClosed(sockets) {
  for (let waited = 0; sockets.size > 0 && waited < 3000; waited += 25) await new Promise((resolve) => setTimeout(resolve, 25));
  return sockets.size === 0;
}

test("a site that sends its page slowly is cut off at the deadline", async () => {
  const drip = (req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    const timer = setInterval(() => res.write("<p>"), 50);
    res.on("close", () => clearInterval(timer));
  };
  await withSite({ "/drip": drip }, async (fetchPage) => {
    const started = Date.now();
    await assert.rejects(fetchPage("https://shop.example/drip", { deadline: Date.now() + 300 }), { message: "The page took too long to answer." });
    assert.ok(Date.now() - started < 1500);
  });
});

test("pages over 2 MB are refused, with or without a declared size", async () => {
  const big = (req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    const chunk = "x".repeat(64 * 1024);
    let sent = 0;
    const more = () => {
      while (sent < 3 * 1024 * 1024) {
        sent += chunk.length;
        if (!res.write(chunk)) return res.once("drain", more);
      }
      res.end();
    };
    res.on("error", () => {});
    more();
  };
  const declared = (req, res) => res.writeHead(200, { "content-length": String(3 * 1024 * 1024) }).end();
  await withSite({ "/big": big, "/declared": declared }, async (fetchPage) => {
    await assert.rejects(fetchPage("https://shop.example/big"), { message: "The page is too large to read." });
    await assert.rejects(fetchPage("https://shop.example/declared"), { message: "The page is too large to read." });
  });
});

test("redirects are followed and checked again; the connection never stays open", async () => {
  const routes = {
    // A redirect that promises a body and never sends it must not keep the connection.
    "/moved": (req, res) => res.writeHead(302, { location: "/page", "content-length": "100000" }).write("x"),
    "/page": (req, res) => res.writeHead(200, { "content-type": "text/html" }).end("<p>ok</p>"),
    "/loop": (req, res) => res.writeHead(302, { location: "/loop" }).end(),
    "/insecure": (req, res) => res.writeHead(301, { location: "http://shop.example/page" }).end(),
    "/inside": (req, res) => res.writeHead(301, { location: "https://169.254.169.254/latest/meta-data" }).end(),
  };
  await withSite(routes, async (fetchPage, sockets) => {
    assert.deepEqual(await fetchPage("https://shop.example/moved"), { url: "https://shop.example/page", body: "<p>ok</p>", type: "text/html" });
    await assert.rejects(fetchPage("https://shop.example/loop"), { message: "The link redirects too many times." });
    await assert.rejects(fetchPage("https://shop.example/insecure"), { message: "Only secure links (https://) can be read." });
    await assert.rejects(fetchPage("https://shop.example/inside"), /IP address or a local name/);
    assert.ok(await allClosed(sockets), "every connection is closed");
  });
});

test("error pages give the status in plain words", async () => {
  await withSite({ "/down": (req, res) => res.writeHead(503).end() }, async (fetchPage) => {
    await assert.rejects(fetchPage("https://shop.example/missing"), { message: "The page wasn't found (404)." });
    await assert.rejects(fetchPage("https://shop.example/down"), { message: "The site answered with an error (503)." });
  });
});
