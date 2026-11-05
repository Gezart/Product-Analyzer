// Unstuck on the storefront: the proxy call helper and the visitor's tracking consent, shared by the
// product page blocks and A/B tests. Plain JavaScript, no dependencies.
(function () {
  var U = (window.Unstuck = window.Unstuck || {});

  /** Whether the visitor allows analytics (Shopify's customer privacy API); false until it's known. */
  U.trackingAllowed = function () {
    try {
      var privacy = window.Shopify && window.Shopify.customerPrivacy;
      return Boolean(privacy && privacy.analyticsProcessingAllowed && privacy.analyticsProcessingAllowed());
    } catch (e) {
      return false;
    }
  };

  /** A call to the app through the proxy (`path` like "events"); resolves to the JSON answer or null. */
  U.call = function (path, body) {
    if (!U.proxy) return Promise.resolve(null);
    var init = body
      ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" }
      : { credentials: "same-origin" };
    return fetch(U.proxy + "/" + path, init)
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .catch(function () {
        return null;
      });
  };

  // Shopify's consent API, so trackingAllowed() can answer.
  if (window.Shopify && typeof window.Shopify.loadFeatures === "function") {
    window.Shopify.loadFeatures([{ name: "consent-tracking-api", version: "0.1" }], function () {});
  }
})();
