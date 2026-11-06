// Unstuck's product page blocks (set in the app's Page builder). Keeps "Only X left" in step with the
// variant the shopper picks. Plain JavaScript, no dependencies.
(function () {
  window.Unstuck = window.Unstuck || {};

  var BLOCK = ".unstuck-product";

  /** The variant picked in the theme's product form (not the app's own add buttons), else the URL's. */
  function pickedVariantId() {
    var inputs = document.querySelectorAll('form[action*="/cart/add"] [name="id"]');
    for (var i = 0; i < inputs.length; i++) {
      if (!inputs[i].closest(BLOCK) && inputs[i].value) return inputs[i].value;
    }
    return new URLSearchParams(window.location.search).get("variant");
  }

  function stockOf(block) {
    var json = block.querySelector("[data-unstuck-stock]");
    try {
      return json ? JSON.parse(json.textContent) : {};
    } catch (e) {
      return {};
    }
  }

  function updateLowStock() {
    var variantId = pickedVariantId();
    if (!variantId) return;
    var texts = document.querySelectorAll("[data-unstuck-low-stock]");
    for (var i = 0; i < texts.length; i++) {
      var text = texts[i];
      var count = stockOf(text.parentNode)[variantId];
      var visible = typeof count === "number" && count > 0 && count <= Number(text.dataset.threshold);
      if (visible) text.textContent = text.dataset.text.split("{count}").join(String(count));
      text.hidden = !visible;
    }
  }

  // Themes change the variant in different ways: a change on the form's options or id input (then the
  // theme updates the id), or a custom event. Read the picked variant once the theme is done.
  function later() {
    window.setTimeout(updateLowStock, 0);
  }
  document.addEventListener("change", later);
  document.addEventListener("variant:change", later);
  window.addEventListener("popstate", later);
})();
