// AI product photos: what the image model is asked, which source photos may be read, and what comes
// back. Pure (no imports) so node:test can load it.

export const AI_PHOTO_MODEL = "gpt-image-2.5-flare";
/** Image token prices per million (USD), for the monthly cost record: an estimate, the bill is OpenAI's. */
const TEXT_INPUT_USD = 5 / 1_000_000;
const IMAGE_INPUT_USD = 8 / 1_000_000;
const IMAGE_OUTPUT_USD = 30 / 1_000_000;

export const PHOTO_STYLES = ["white", "scene"];
export const MAX_SCENE_LENGTH = 200;
/** Source and uploaded photos up to this size (OpenAI takes up to 50 MB; Shopify's CDN is asked for at most 2048 px). */
export const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
/** A draft not added within a day is removed (with its image). */
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

const KEEP_PRODUCT = `Keep the product exactly as it is in the photo: the same shape, proportions, colors, materials, texture, printed text, logos and every detail. Don't add, remove or change any part of the product, and don't make it look better than it is: shoppers must receive what they see.`;
const NO_EXTRAS = `No text, watermarks, badges or borders. No other products, and no props that could be taken for part of what's sold.`;

/**
 * The edit request for one photo. `white`: a plain white studio background (the main photo style
 * marketplaces ask for). `scene`: the product in a realistic setting, the merchant's own if given.
 */
export function photoPrompt({ title, productType, style, scene }) {
  const what = [title && `The product: ${title}`, productType && `(${productType})`].filter(Boolean).join(" ");
  const lines = [`Edit this product photo for an online store.${what ? ` ${what}.` : ""}`, KEEP_PRODUCT];
  if (style === "white") {
    lines.push("Replace the background with a clean, plain white studio background (#FFFFFF) with a soft, natural shadow under the product. Center the product and leave some space around it. Even, soft studio light.");
  } else {
    const setting = scene?.trim()
      ? `this setting: ${scene.trim()}`
      : "a simple, realistic setting that suits it, such as where it would be used or kept";
    lines.push(`Place the product in ${setting}. Realistic scale, natural light, the product in sharp focus as the clear subject of the photo. Keep any props few, plain and clearly separate from the product.`);
  }
  lines.push(NO_EXTRAS);
  return lines.join("\n\n");
}

/** The merchant's input for a photo, or `{ error }`. */
export function validatePhotoRequest(body) {
  const style = body?.style;
  if (!PHOTO_STYLES.includes(style)) return { error: "Choose a white background or a scene." };
  if (typeof body?.mediaId !== "string" || !/^gid:\/\/shopify\/MediaImage\/\d+$/.test(body.mediaId)) return { error: "Choose one of the product's photos." };
  let scene = null;
  if (style === "scene" && body.scene != null) {
    if (typeof body.scene !== "string") return { error: "The scene must be text." };
    // One line of plain text: no control characters.
    scene = body.scene.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim();
    if (scene.length > MAX_SCENE_LENGTH) return { error: `Describe the scene in up to ${MAX_SCENE_LENGTH} characters.` };
    scene ||= null;
  }
  return { mediaId: body.mediaId, style, scene };
}

/**
 * The address to read a product photo from: only Shopify's CDN over https (the URL comes from the
 * Admin API; nothing else is fetched), asked for at most 2048 px wide. Null for any other address.
 */
export function sourcePhotoUrl(previewUrl) {
  let url;
  try {
    url = new URL(previewUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "cdn.shopify.com" || url.username || url.password || url.port) return null;
  url.searchParams.set("width", "2048");
  return url.toString();
}

/** The image type from the file's first bytes (not what it claims to be): jpeg, png or webp; else null. */
export function imageTypeOf(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? []);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export const EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** What a photo cost, from the image API's token usage (an estimate at list prices). */
export function photoCostUsd(usage) {
  const details = usage?.input_tokens_details ?? {};
  const imageIn = details.image_tokens ?? 0;
  const textIn = details.text_tokens ?? Math.max(0, (usage?.input_tokens ?? 0) - imageIn);
  const cost = textIn * TEXT_INPUT_USD + imageIn * IMAGE_INPUT_USD + (usage?.output_tokens ?? 0) * IMAGE_OUTPUT_USD;
  return Math.round(cost * 10000) / 10000;
}

/** The alt text of an AI photo: what it shows, and that it was made with AI (also visible in Shopify). */
export function aiPhotoAlt(title, style) {
  const base = String(title ?? "").trim().slice(0, 400) || "Product";
  return `${base}${style === "white" ? " on a white background" : " in a scene"} (AI-made photo)`;
}
