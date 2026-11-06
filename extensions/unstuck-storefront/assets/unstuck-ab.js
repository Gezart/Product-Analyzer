// Unstuck A/B tests on the product page, loaded only where a test runs (the app embed renders it with
// the test's data, snippets/ab-test.liquid). Visitors who allow tracking are split 50/50 by a random id
// kept in this browser; "b" visitors see version B of the title, description or photo order. Views and
// add-to-carts go to the app through the proxy, and the tested product's "Add to cart" carries the test
// and the id as a hidden line item property, so its purchases are found in the orders. Without consent:
// the page as it is, nothing stored or sent. Plain JavaScript, no dependencies.
(function () {
  var U = (window.Unstuck = window.Unstuck || {});

  /** 32-bit hash; the same as hash32 in the app (src/lib/ab-tests.js): both must pick the same version. */
  function hash32(text) {
    var h = 0x811c9dc5;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }

  /** The version a visitor sees: fixed per test and visitor, half "a" and half "b". */
  U.abVariant = function (testId, visitorId) {
    return hash32(testId + ":" + visitorId) % 2 === 1 ? "b" : "a";
  };

  if (typeof document === "undefined") return;
  var box = document.querySelector("[data-unstuck-ab]");
  if (!box || box.hasAttribute("data-unstuck-ab-ready")) return;
  box.setAttribute("data-unstuck-ab-ready", "");

  var VISITOR_KEY = "unstuck_ab_visitor";
  var PROPERTY = "properties[_unstuck_ab]";
  /** How long a returning "b" visitor's page waits (parts hidden) for the consent answer. */
  var WAIT_MS = 1000;
  var IMAGE_ATTRS = ["src", "srcset", "data-src", "data-srcset", "href"];

  var testId = box.getAttribute("data-test") || "";
  var kind = box.getAttribute("data-kind");
  var variants = (box.getAttribute("data-variants") || "").split(",");
  var root = document.querySelector("main") || document.body;

  function norm(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  /** Text that belongs to the page (not scripts, templates, form fields or this test's own data). */
  function usable(el) {
    return el && el.closest && !el.closest("script, style, template, noscript, title, textarea, select, [data-unstuck-ab]");
  }

  function textNodes(each) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (var node = walker.nextNode(); node; node = walker.nextNode()) {
      if (each(node) === false) return;
    }
  }

  // ── Title: every text on the page that is exactly the product's title ──────────────────────────
  function titleChange() {
    var a = norm(box.getAttribute("data-title-a"));
    var b = box.getAttribute("data-title-b") || "";
    var nodes = [];
    if (a && b) {
      textNodes(function (node) {
        if (norm(node.nodeValue) === a && usable(node.parentNode)) nodes.push(node);
      });
    }
    return {
      found: nodes.length > 0,
      elements: nodes.map(function (n) {
        return n.parentNode;
      }),
      apply: function () {
        nodes.forEach(function (n) {
          var value = n.nodeValue;
          n.nodeValue = value.match(/^\s*/)[0] + b + value.match(/\s*$/)[0];
        });
      },
    };
  }

  // ── Description: the element whose text is exactly the description's ──────────────────────────
  /** Elements that hold text, not blocks: B's HTML (paragraphs, lists) can't go inside them. */
  var TEXT_ONLY = /^(P|SPAN|H[1-6]|STRONG|EM|B|I|U|A|FONT|SMALL|LABEL)$/;

  /**
   * The smallest element whose text is the description's; when that is a paragraph (a description of
   * one paragraph, in the theme's <div class="rte">), the container that holds it, so B's HTML takes
   * A's place instead of going inside A's paragraph.
   */
  function findByText(text) {
    var found = null;
    textNodes(function (node) {
      var piece = norm(node.nodeValue);
      if (!piece || text.indexOf(piece) !== 0 || !usable(node.parentNode)) return;
      for (var el = node.parentNode; el && el !== root.parentNode; el = el.parentNode) {
        var all = norm(el.textContent);
        if (all === text) {
          found = el;
          return false;
        }
        if (all.length > text.length) return;
      }
    });
    while (found && TEXT_ONLY.test(found.tagName) && found.parentNode && found !== root && found.parentNode !== root && norm(found.parentNode.textContent) === text) {
      found = found.parentNode;
    }
    return found;
  }

  function descriptionChange() {
    var a = box.querySelector("template[data-unstuck-ab-a]");
    var b = box.querySelector("template[data-unstuck-ab-b]");
    var text = a ? norm(a.content.textContent) : "";
    var target = text && b ? findByText(text) : null;
    return {
      found: Boolean(target),
      elements: target ? [target] : [],
      apply: function () {
        target.textContent = "";
        target.appendChild(b.content.cloneNode(true));
      },
    };
  }

  // ── Photos: each photo on the page is shown as B's photo at the same place in the order ─────────
  /** A Shopify CDN photo's name without its size suffix ("shirt" for …/files/shirt_800x.jpg?v=1). */
  function keyOf(url) {
    var u;
    try {
      u = new URL(url, window.location.href);
    } catch (e) {
      return null;
    }
    if (!/\/(cdn\/shop|s\/files)\//.test(u.pathname)) return null;
    var name = u.pathname.split("/").pop() || "";
    try {
      name = decodeURIComponent(name);
    } catch (e) {}
    var dot = name.lastIndexOf(".");
    if (dot > 0) name = name.slice(0, dot);
    name = name
      .replace(/@\dx$/, "")
      .replace(/_crop_[a-z]+$/i, "")
      .replace(/_(\d+x\d*|x\d+|pico|icon|thumb|small|compact|medium|large|grande|original|master)$/i, "");
    return name.toLowerCase() || null;
  }

  function imagesChange() {
    var none = { found: false };
    var aEls = box.querySelectorAll("[data-unstuck-ab-a]");
    var bEls = box.querySelectorAll("[data-unstuck-ab-b]");
    if (aEls.length < 2 || aEls.length !== bEls.length) return none;
    var srcById = {};
    var order = [];
    for (var i = 0; i < aEls.length; i++) {
      srcById[aEls[i].getAttribute("data-id")] = aEls[i].getAttribute("data-src");
      order.push(aEls[i].getAttribute("data-id"));
    }
    var swap = {};
    for (var j = 0; j < bEls.length; j++) {
      var bId = bEls[j].getAttribute("data-id");
      var key = keyOf(srcById[order[j]]);
      if (!srcById[bId] || !key) return none;
      if (bId !== order[j]) swap[key] = srcById[bId];
    }
    var produced = {};

    function rewrite(url, initial) {
      if (!initial && produced[url]) return null;
      var key = keyOf(url);
      if (!key || !Object.prototype.hasOwnProperty.call(swap, key)) return null;
      var from = new URL(url, window.location.href);
      var to = new URL(swap[key], window.location.href);
      from.searchParams.forEach(function (value, name) {
        if (name !== "v") to.searchParams.set(name, value);
      });
      var legacy = from.pathname.match(/_(\d+)x\d*(?:_crop_[a-z]+)?(?:@(\d)x)?\.[a-z0-9]+$/i);
      if (legacy && !to.searchParams.has("width")) to.searchParams.set("width", String(Number(legacy[1]) * Number(legacy[2] || 1)));
      var next = url.indexOf("//") === 0 ? to.href.replace(/^https?:/, "") : to.href;
      produced[next] = true;
      return next;
    }

    function rewriteSet(value, initial) {
      var changed = false;
      var parts = value.split(",").map(function (part) {
        var bits = part.trim().split(/\s+/);
        var next = rewrite(bits[0], initial);
        if (next) {
          changed = true;
          bits[0] = next;
        }
        return bits.join(" ");
      });
      return changed ? parts.join(", ") : null;
    }

    /** New values for an element's photo attributes (all worked out before any is set). */
    function changesOf(el, initial) {
      var out = [];
      IMAGE_ATTRS.forEach(function (name) {
        var value = el.getAttribute(name);
        if (!value || (name === "href" && el.tagName !== "A")) return;
        var next = name.indexOf("srcset") >= 0 ? rewriteSet(value, initial) : rewrite(value, initial);
        if (next) out.push([el, name, next]);
      });
      return out;
    }

    var firstKey = keyOf(srcById[order[0]]);
    var shown = [];
    var all = document.querySelectorAll("img, source, a[href]");
    for (var k = 0; k < all.length; k++) {
      if (!usable(all[k])) continue;
      var refs = IMAGE_ATTRS.some(function (name) {
        var value = all[k].getAttribute(name) || "";
        return value.split(",").some(function (part) {
          return keyOf(part.trim().split(/\s+/)[0]) === firstKey;
        });
      });
      if (refs) shown.push(all[k]);
    }

    return {
      found: shown.length > 0,
      elements: shown.filter(function (el) {
        return el.tagName === "IMG";
      }),
      apply: function () {
        var changes = [];
        for (var n = 0; n < all.length; n++) if (usable(all[n])) changes = changes.concat(changesOf(all[n], true));
        changes.forEach(function (c) {
          c[0].setAttribute(c[1], c[2]);
        });
        // Galleries and lazy loaders add or change photos later: those are shown as B's too.
        if (typeof MutationObserver !== "function") return;
        new MutationObserver(function (records) {
          records.forEach(function (record) {
            var els = record.type === "attributes" ? [record.target] : [];
            if (record.type === "childList") {
              Array.prototype.forEach.call(record.addedNodes, function (node) {
                if (node.nodeType !== 1) return;
                els.push(node);
                els = els.concat(Array.prototype.slice.call(node.querySelectorAll("img, source, a[href]")));
              });
            }
            els.forEach(function (el) {
              if (!/^(IMG|SOURCE|A)$/.test(el.tagName) || !usable(el)) return;
              changesOf(el, false).forEach(function (c) {
                c[0].setAttribute(c[1], c[2]);
              });
            });
          });
        }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: IMAGE_ATTRS });
      },
    };
  }

  // ── Visitor, consent and counting ────────────────────────────────────────────────────────────
  function readVisitor() {
    try {
      var id = window.localStorage.getItem(VISITOR_KEY);
      return /^[0-9a-f]{32}$/.test(id || "") ? id : null;
    } catch (e) {
      return null;
    }
  }

  function newVisitor() {
    try {
      var bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      var id = "";
      for (var i = 0; i < bytes.length; i++) id += ("0" + bytes[i].toString(16)).slice(-2);
      window.localStorage.setItem(VISITOR_KEY, id);
      return id;
    } catch (e) {
      return null;
    }
  }

  function allowedNow() {
    try {
      var privacy = window.Shopify && window.Shopify.customerPrivacy;
      return Boolean(privacy && privacy.analyticsProcessingAllowed && privacy.analyticsProcessingAllowed());
    } catch (e) {
      return false;
    }
  }

  /** Calls `done(allowed, immediate)` once: right away when Shopify's consent API is loaded, else when it is (or not, after WAIT_MS). */
  function consent(onWait, done) {
    var finished = false;
    function finish(allowed, immediate) {
      if (finished) return;
      finished = true;
      done(allowed, immediate);
    }
    var privacy = window.Shopify && window.Shopify.customerPrivacy;
    if (privacy && typeof privacy.analyticsProcessingAllowed === "function") return finish(allowedNow(), true);
    if (!(window.Shopify && typeof window.Shopify.loadFeatures === "function")) return finish(false, true);
    onWait();
    window.Shopify.loadFeatures([{ name: "consent-tracking-api", version: "0.1" }], function (error) {
      finish(!error && allowedNow(), false);
    });
    window.setTimeout(function () {
      finish(false, false);
    }, WAIT_MS);
  }

  function send(event, visitor) {
    if (!U.proxy || !window.fetch) return;
    try {
      window
        .fetch(U.proxy + "/ab", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ test: testId, visitor: visitor, event: event }),
          credentials: "same-origin",
          keepalive: true,
        })
        .catch(function () {});
    } catch (e) {}
  }

  /** A form that adds this product to the cart (not the app's "Often bought together" or other products). */
  function isProductForm(form) {
    if (!form || form.tagName !== "FORM" || !/\/cart\/add/.test(form.getAttribute("action") || "")) return false;
    var id = form.elements && form.elements.namedItem("id");
    return Boolean(id && variants.indexOf(String(id.value)) !== -1);
  }

  function start(visitor) {
    if (U.abVariant(testId, visitor) === "b") change.apply();
    var forms = document.querySelectorAll('form[action*="/cart/add"]');
    for (var i = 0; i < forms.length; i++) {
      if (!isProductForm(forms[i]) || (forms[i].elements && forms[i].elements.namedItem(PROPERTY))) continue;
      var input = document.createElement("input");
      input.type = "hidden";
      input.name = PROPERTY;
      input.value = testId + ":" + visitor;
      forms[i].appendChild(input);
    }
    send("view", visitor);
    document.addEventListener(
      "submit",
      function (event) {
        if (isProductForm(event.target)) send("cart", visitor);
      },
      true,
    );
  }

  var change = kind === "title" ? titleChange() : kind === "description" ? descriptionChange() : kind === "images" ? imagesChange() : null;
  // B can't be shown on this page (the theme shows it differently): nobody is counted, so A and B stay comparable.
  if (!change || !change.found) return;

  var stored = readVisitor();
  var hidden = [];
  consent(
    function () {
      // A returning "b" visitor: the parts that change stay hidden until consent is known (no flash of A).
      if (!stored || U.abVariant(testId, stored) !== "b") return;
      change.elements.forEach(function (el) {
        hidden.push([el, el.style.visibility]);
        el.style.visibility = "hidden";
      });
    },
    function (allowed, immediate) {
      if (allowed) {
        // A new visitor joins on this page only when the answer was there at once; else from the next
        // product page, so nobody sees the page switch from A to B.
        var visitor = stored || newVisitor();
        if (visitor && (stored || immediate)) start(visitor);
      }
      hidden.forEach(function (h) {
        h[0].style.visibility = h[1];
      });
    },
  );
})();
