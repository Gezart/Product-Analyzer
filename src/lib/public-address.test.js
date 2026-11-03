import assert from "node:assert/strict";
import { test } from "node:test";
import { isPublicAddress, normalizeLink } from "./public-address.js";

test("private, local and reserved IPv4 addresses are not public", () => {
  for (const ip of ["0.0.0.0", "10.1.2.3", "127.0.0.1", "100.64.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.1.1", "192.0.0.8", "192.0.2.1", "198.18.0.1", "198.51.100.7", "203.0.113.9", "224.0.0.1", "255.255.255.255"]) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  for (const ip of ["8.8.8.8", "23.227.38.65", "172.32.0.1", "100.128.0.1", "192.169.1.1"]) assert.equal(isPublicAddress(ip), true, ip);
});

test("IPv6: loopback, unique local, link-local, mapped private IPv4 and NAT64 to private are not public", () => {
  for (const ip of ["::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "2001:db8::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:169.254.169.254", "64:ff9b::a9fe:a9fe"]) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  for (const ip of ["2606:4700::6810:85e5", "::ffff:8.8.8.8", "2a00:1450:4001:81c::200e"]) assert.equal(isPublicAddress(ip), true, ip);
});

test("anything that isn't an IP address is not treated as public", () => {
  assert.equal(isPublicAddress("localhost"), false);
  assert.equal(isPublicAddress(""), false);
});

test("links: https only, default port, real host names, no credentials, fragment removed", () => {
  assert.deepEqual(normalizeLink("  https://www.Shop.example/products/linen-shirt?variant=12#reviews "), {
    url: "https://www.shop.example/products/linen-shirt?variant=12",
    host: "shop.example",
  });
  assert.equal(normalizeLink("https://shop.example:443/p").url, "https://shop.example/p");
  for (const bad of ["http://shop.example/p", "ftp://shop.example/p", "https://user:pw@shop.example/p", "https://shop.example:8443/p", "https://127.0.0.1/p", "https://[::1]/p", "https://localhost/p", "https://printer.local/p", "https://db.internal/p", "not a link", "", "https://" + "a".repeat(2000) + ".example"]) {
    assert.ok(normalizeLink(bad).error, bad);
  }
});
