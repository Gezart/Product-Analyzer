import assert from "node:assert/strict";
import { test } from "node:test";
import { activeHref, NAV } from "./nav.js";

test("the menu item each page belongs to", () => {
  assert.equal(activeHref("/"), "/");
  assert.equal(activeHref("/products"), "/products");
  assert.equal(activeHref("/products/abc"), "/products");
  assert.equal(activeHref("/plan"), "/inbox"); // the weekly plan lives with the inbox
  assert.equal(activeHref("/plans"), "/plans"); // not the weekly plan
  assert.equal(activeHref("/productsx"), null);
  assert.equal(activeHref("/page-builder"), "/page-builder");
  assert.equal(activeHref("/ab-tests"), "/ab-tests");
  assert.equal(activeHref("/dev/shopifyql"), null);
  assert.deepEqual(NAV.map((n) => n.label), ["Dashboard", "Products", "Inbox", "Results", "Collections", "Page builder", "A/B tests", "Compare", "Reports", "Plans", "Settings"]);
});
