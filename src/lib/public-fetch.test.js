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
