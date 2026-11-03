import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanDescriptionHtml, descriptionPrompt, draftFromAnswer, fillInsLeft, requestCostUsd } from "./ai-text.js";

test("the request names the product's facts, its options and what the diagnosis found", () => {
  const text = descriptionPrompt(
    {
      title: "Linen Shirt",
      productType: "Shirts",
      vendor: "Acme",
      tags: ["summer", "season:jun-aug"],
      description: "  A shirt.  ",
      variants: [{ options: { Size: "S", Color: "White" } }, { options: { Size: "M", Color: "White" } }, { options: { Title: "Default Title" } }],
    },
    ["short_description", "missing_details", "few_images"],
  );
  assert.match(text, /^Title: Linen Shirt$/m);
  assert.match(text, /^Size: S, M$/m);
  assert.match(text, /^Color: White$/m);
  assert.match(text, /^Tags: summer$/m, "season tags are the app's, not the shopper's");
  assert.match(text, /^Current description: A shirt\.$/m);
  assert.match(text, /What to fix: the description is too short; the description doesn't mention size/);
  assert.doesNotMatch(text, /Default Title/);
  assert.match(descriptionPrompt({ title: "Mug" }), /Current description: \(none\)/);
});

test("only simple tags without attributes reach Shopify", () => {
  assert.equal(
    cleanDescriptionHtml('<p onclick="x()" style="color:red">Soft <strong class="a">linen</strong></p><script>alert(1)</script><a href="https://evil">link</a><img src=x onerror=y><ul><li>A</li></ul>'),
    "<p>Soft <strong>linen</strong></p>link<ul><li>A</li></ul>",
  );
  assert.equal(cleanDescriptionHtml("<P>Hi</P><!-- note --><br/>"), "<p>Hi</p><br>");
  assert.equal(cleanDescriptionHtml("5 < 6 and <3"), "5 &lt; 6 and &lt;3");
  assert.equal(cleanDescriptionHtml(null), "");
  // Pieces of removed tags never join into a new tag.
  assert.equal(cleanDescriptionHtml("<<a>img src=x onerror=alert(1)>"), "&lt;img src=x onerror=alert(1)&gt;");
  assert.equal(cleanDescriptionHtml("<<x>script>alert(1)<</x>/script>"), "&lt;script&gt;alert(1)&lt;/script&gt;");
  assert.equal(cleanDescriptionHtml("<scr<script>x</script>ipt>alert(1)</script>"), "");
  assert.equal(cleanDescriptionHtml("<p>a > b</p>"), "<p>a &gt; b</p>");
});

test("placeholders left to fill in, across the description and SEO", () => {
  assert.deepEqual(fillInsLeft("<p>Made of [fill in: material], [Fill in: care].</p>", "Shirt [fill in: material]", ""), ["material", "care"]);
  assert.deepEqual(fillInsLeft("<p>Done.</p>"), []);
  assert.deepEqual(fillInsLeft("<p>Size [fill in size</p>", "[Fill-in]"), ["size", "the missing detail"]);
});

test("the cost of a request at Claude Opus 5.5 prices", () => {
  assert.equal(requestCostUsd({ input_tokens: 2000, output_tokens: 800 }), 0.024);
  assert.equal(requestCostUsd({ input_tokens: 1000, cache_read_input_tokens: 1000, output_tokens: 0 }), 0.008);
  assert.equal(requestCostUsd(undefined), 0);
});

test("the draft from Claude's answer: cleaned, cut to Shopify's limits, placeholders listed", () => {
  const d = draftFromAnswer({ description_html: "<p>Linen <b>shirt</b> in [fill in: material].</p><script>x</script>", seo_title: "T".repeat(90), seo_description: "Buy it", fill_in: ["material"] });
  assert.equal(d.descriptionHtml, "<p>Linen <b>shirt</b> in [fill in: material].</p>");
  assert.equal(d.seoTitle.length, 70);
  assert.deepEqual(d.fillIn, ["material"]);
  // A placeholder written another way is still one; one only listed is added to the text.
  const fr = draftFromAnswer({ description_html: "<p>Fait en [à compléter : matière].</p>", seo_title: "x", seo_description: "y", fill_in: ["matière"] });
  assert.equal(fr.descriptionHtml, "<p>Fait en [fill in: à compléter : matière].</p>");
  assert.deepEqual(fr.fillIn, ["à compléter : matière"]);
  const listed = draftFromAnswer({ description_html: "<p>Linen shirt.</p>", seo_title: "x", seo_description: "y", fill_in: ["care"] });
  assert.equal(listed.descriptionHtml, "<p>Linen shirt.</p>\n<p>[fill in: care]</p>");
  assert.deepEqual(listed.fillIn, ["care"]);
  assert.equal(draftFromAnswer({ description_html: "  " }), null);
  assert.equal(draftFromAnswer(null), null);
});
