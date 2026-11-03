// OpenAI's image API for AI product photos (an edit of one of the product's photos). Plain fetch, no
// SDK. Needs OPENAI_API_KEY.

import { AiError } from "@/lib/ai/errors";
import { AI_PHOTO_MODEL, EXTENSIONS, imageTypeOf, photoCostUsd } from "@/lib/ai-photo";

const ENDPOINT = "https://api.openai.com/v1/images/edits";
/** Making a photo takes up to a minute or two. */
const TIMEOUT_MS = 150_000;

/** The app owner has set the API key. */
export const openaiConfigured = () => Boolean(process.env.OPENAI_API_KEY);

/** The merchant-facing failure for an error answer from the API (logged for the owner). */
function failure(status, error) {
  const code = error?.code ?? "";
  console.error("[ai-photo] OpenAI error", status, code, error?.message);
  if (status === 401 || status === 403 || code === "insufficient_quota" || code === "billing_hard_limit_reached") {
    return new AiError("Photos with AI aren't available right now (the app's AI access needs attention).");
  }
  if (code === "moderation_blocked" || error?.type === "image_generation_user_error") {
    return new AiError("The AI declined to make this photo. Try another photo or scene.", 422);
  }
  if (status === 429) return new AiError("The AI is busy right now. Try again in a minute.", 429);
  if (status === 400) return new AiError("This photo couldn't be used. Try another one.", 422);
  return new AiError("The AI couldn't make the photo right now. Try again.");
}

/**
 * Edits one product photo (`bytes`, jpeg/png/webp) as `prompt` says. Resolves `{ bytes, mimeType,
 * costUsd }` with the image exactly as OpenAI returns it (its metadata kept); throws `AiError`.
 */
export async function editProductPhoto({ bytes, mimeType, prompt }) {
  const form = new FormData();
  form.append("model", AI_PHOTO_MODEL);
  form.append("image", new Blob([bytes], { type: mimeType }), `product.${EXTENSIONS[mimeType] ?? "jpg"}`);
  form.append("prompt", prompt);
  form.append("n", "1");
  form.append("size", "auto");
  form.append("quality", "high");
  form.append("background", "opaque");
  form.append("output_format", "jpeg");
  form.append("output_compression", "92");

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    console.error("[ai-photo] OpenAI request failed", error?.name, error?.message);
    throw new AiError(error?.name === "TimeoutError" ? "Making the photo took too long. Try again." : "The AI couldn't make the photo right now. Try again.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw failure(res.status, body?.error);

  const b64 = body?.data?.[0]?.b64_json;
  const out = typeof b64 === "string" ? Buffer.from(b64, "base64") : null;
  const type = out && imageTypeOf(out);
  const costUsd = photoCostUsd(body?.usage);
  if (!type) throw Object.assign(new AiError("The AI's photo couldn't be read. Try again."), { costUsd });
  return { bytes: out, mimeType: type, costUsd };
}
