// Unstuck's product page blocks and full product page (set in the app's Page builder). Keeps "Only X
// left" in step with the variant the shopper picks, and runs the full page's photos and variant picker.
// Plain JavaScript, no dependencies.
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

  // ── The full product page (blocks/product-layout.liquid) ─────────────────────────────────────
  function initLayout(root) {
    if (root.hasAttribute("data-unstuck-ready")) return;
    root.setAttribute("data-unstuck-ready", "");
    var gallery = root.querySelector("[data-unstuck-gallery]");

    /** Shows a photo: the big one with thumbnails; other styles keep every photo where it is. */
    function showMedia(id) {
      if (!gallery || !id || !gallery.classList.contains("unstuck-gallery--thumbnails")) return;
      var target = gallery.querySelector('.unstuck-gallery__slide[data-media-id="' + id + '"]');
      if (!target) return;
      var slides = gallery.querySelectorAll(".unstuck-gallery__slide");
      for (var i = 0; i < slides.length; i++) slides[i].hidden = slides[i] !== target;
      var thumbs = gallery.querySelectorAll(".unstuck-gallery__thumb");
      for (var j = 0; j < thumbs.length; j++) {
        if (thumbs[j].getAttribute("data-media-id") === id) thumbs[j].setAttribute("aria-current", "true");
        else thumbs[j].removeAttribute("aria-current");
      }
    }

    if (gallery) {
      gallery.addEventListener("click", function (event) {
        var thumb = event.target.closest && event.target.closest(".unstuck-gallery__thumb");
        if (thumb) showMedia(thumb.getAttribute("data-media-id"));
      });
    }

    var selects = root.querySelectorAll("[data-unstuck-option]");
    var variants = root.querySelectorAll("[data-unstuck-variants] li");
    var idInput = root.querySelector('form [name="id"]');
    var add = root.querySelector("[data-unstuck-add]");
    if (!selects.length || !idInput || !add) return;

    function setHtml(selector, html) {
      var el = root.querySelector(selector);
      if (!el) return;
      el.innerHTML = html;
      el.hidden = !html;
    }

    function update() {
      var match = null;
      for (var i = 0; i < variants.length && !match; i++) {
        var fits = true;
        for (var k = 0; k < selects.length; k++) {
          var index = selects[k].getAttribute("data-unstuck-option");
          if (variants[i].getAttribute("data-option" + index) !== selects[k].value) fits = false;
        }
        if (fits) match = variants[i];
      }
      if (!match) {
        add.disabled = true;
        add.textContent = add.getAttribute("data-unavailable");
        return;
      }
      var available = match.getAttribute("data-available") === "true";
      idInput.value = match.getAttribute("data-id");
      setHtml("[data-unstuck-price]", match.getAttribute("data-price"));
      setHtml("[data-unstuck-was]", match.getAttribute("data-was"));
      var sale = root.querySelector("[data-unstuck-sale]");
      if (sale) sale.hidden = !match.getAttribute("data-was");
      add.disabled = !available;
      add.textContent = add.getAttribute(available ? "data-add" : "data-sold-out");
      showMedia(match.getAttribute("data-media"));
      try {
        var url = new URL(window.location.href);
        url.searchParams.set("variant", idInput.value);
        window.history.replaceState(window.history.state, "", url.toString());
      } catch (e) {}
      document.dispatchEvent(new CustomEvent("variant:change", { detail: { variantId: idInput.value } }));
    }

    for (var s = 0; s < selects.length; s++) selects[s].addEventListener("change", update);
  }

  function initLayouts() {
    var roots = document.querySelectorAll("[data-unstuck-layout]");
    for (var i = 0; i < roots.length; i++) initLayout(roots[i]);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initLayouts);
  else initLayouts();
  // The theme editor re-renders blocks while the merchant edits.
  document.addEventListener("shopify:section:load", initLayouts);
})();
