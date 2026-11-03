import assert from "node:assert/strict";
import { test } from "node:test";
import { aiPhotoAlt, imageTypeOf, photoCostUsd, photoPrompt, sourcePhotoUrl, validatePhotoRequest } from "./ai-photo.js";

test("the photo request keeps the product as it is and sets the background or scene", () => {
  const white = photoPrompt({ title: "Linen Shirt", productType: "Shirts", style: "white" });
  assert.match(white, /The product: Linen Shirt \(Shirts\)\./);
  assert.match(white, /exactly as it is/);
  assert.match(white, /white studio background/);
  assert.match(white, /No text, watermarks/);
  const scene = photoPrompt({ title: "Mug", style: "scene", scene: "on a wooden kitchen table" });
  assert.match(scene, /this setting: on a wooden kitchen table/);
  assert.match(photoPrompt({ title: "Mug", style: "scene" }), /a simple, realistic setting/);
});

test("the merchant's photo request is checked", () => {
  const ok = { mediaId: "gid://shopify/MediaImage/12", style: "scene", scene: "  on a beach\n at sunset " };
  assert.deepEqual(validatePhotoRequest(ok), { mediaId: "gid://shopify/MediaImage/12", style: "scene", scene: "on a beach at sunset" });
  assert.deepEqual(validatePhotoRequest({ mediaId: "gid://shopify/MediaImage/12", style: "white", scene: "ignored" }), { mediaId: "gid://shopify/MediaImage/12", style: "white", scene: null });
  assert.ok(validatePhotoRequest({ mediaId: "gid://shopify/Video/1", style: "white" }).error);
  assert.ok(validatePhotoRequest({ mediaId: "gid://shopify/MediaImage/1", style: "neon" }).error);
  assert.ok(validatePhotoRequest({ mediaId: "gid://shopify/MediaImage/1", style: "scene", scene: "x".repeat(201) }).error);
  assert.equal(validatePhotoRequest({ mediaId: "gid://shopify/MediaImage/1", style: "scene", scene: "   " }).scene, null);
});

test("only Shopify's CDN is read for source photos", () => {
  assert.equal(sourcePhotoUrl("https://cdn.shopify.com/s/files/1/shirt.jpg?v=3"), "https://cdn.shopify.com/s/files/1/shirt.jpg?v=3&width=2048");
  assert.equal(sourcePhotoUrl("http://cdn.shopify.com/s/files/1/shirt.jpg"), null);
  assert.equal(sourcePhotoUrl("https://cdn.shopify.com.evil.example/x.jpg"), null);
  assert.equal(sourcePhotoUrl("https://user@cdn.shopify.com/x.jpg"), null);
  assert.equal(sourcePhotoUrl("https://169.254.169.254/latest"), null);
  assert.equal(sourcePhotoUrl(null), null);
});

test("image type from the file's bytes", () => {
  assert.equal(imageTypeOf(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(imageTypeOf(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), "image/png");
  assert.equal(imageTypeOf(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
  assert.equal(imageTypeOf(new TextEncoder().encode("GIF89a")), null);
  assert.equal(imageTypeOf(new TextEncoder().encode("<svg onload=x>")), null);
  assert.equal(imageTypeOf(null), null);
});

test("photo cost from token usage, and the AI alt text", () => {
  // 50 text + 1000 image tokens in, 4000 out: 0.00025 + 0.008 + 0.12
  assert.equal(photoCostUsd({ input_tokens: 1050, input_tokens_details: { text_tokens: 50, image_tokens: 1000 }, output_tokens: 4000 }), 0.1283);
  assert.equal(photoCostUsd(null), 0);
  assert.equal(aiPhotoAlt("Linen Shirt", "white"), "Linen Shirt on a white background (AI-made photo)");
  assert.equal(aiPhotoAlt("", "scene"), "Product in a scene (AI-made photo)");
});
