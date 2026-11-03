// Claude (Anthropic API) for AI product descriptions. Needs ANTHROPIC_API_KEY.

import Anthropic from "@anthropic-ai/sdk";
import { AiError } from "@/lib/ai/errors";
import { AI_TEXT_MODEL, DESCRIPTION_SCHEMA, DESCRIPTION_SYSTEM, requestCostUsd } from "@/lib/ai-text";

export { AiError };

let client = null;
// A draft takes well under a minute; one retry for a dropped connection or an overloaded API.
const anthropic = () => (client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 90_000, maxRetries: 1 }));

/** The app owner has set the API key. */
export const claudeConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

/**
 * Asks Claude for a description draft (structured JSON: `DESCRIPTION_SCHEMA`), with the product's photos
 * when it can read them. If Claude declines (a refusal), Anthropic's recommended fallback model answers
 * instead (`fallbacks: "default"`). Resolves `{ json, usage }`; throws `AiError` with a readable message.
 */
export async function writeDescription({ prompt, imageUrls = [] }) {
  const request = (images) => ({
    model: AI_TEXT_MODEL,
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema: DESCRIPTION_SCHEMA } },
    system: DESCRIPTION_SYSTEM,
    messages: [
      {
        role: "user",
        content: [...images.map((url) => ({ type: "image", source: { type: "url", url } })), { type: "text", text: prompt }],
      },
    ],
  });
  let response;
  try {
    try {
      response = await anthropic().beta.messages.create(request(imageUrls));
    } catch (error) {
      // A photo the API can't fetch shouldn't stop the draft: try once more with text only.
      if (!(error instanceof Anthropic.BadRequestError) || imageUrls.length === 0) throw error;
      response = await anthropic().beta.messages.create(request([]));
    }
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      console.error("[ai] Anthropic key refused", error.message);
      throw new AiError("Writing with AI isn't available right now (the app's AI access needs attention).");
    }
    if (error instanceof Anthropic.RateLimitError) throw new AiError("The AI is busy right now. Try again in a minute.", 429);
    if (error instanceof Anthropic.APIError) {
      console.error("[ai] Anthropic API error", error.status, error.message);
      throw new AiError("The AI couldn't write a draft right now. Try again.");
    }
    throw error;
  }
  const usage = {
    inputTokens: (response.usage?.input_tokens ?? 0) + (response.usage?.cache_read_input_tokens ?? 0) + (response.usage?.cache_creation_input_tokens ?? 0),
    outputTokens: response.usage?.output_tokens ?? 0,
    costUsd: requestCostUsd(response.usage),
  };
  if (response.stop_reason === "refusal") throw Object.assign(new AiError("The AI declined to write this description."), { usage });
  if (response.stop_reason === "max_tokens") throw Object.assign(new AiError("The AI's answer was cut off. Try again."), { usage });
  const text = response.content.find((b) => b.type === "text")?.text;
  try {
    return { json: JSON.parse(text), usage };
  } catch {
    throw Object.assign(new AiError("The AI's answer couldn't be read. Try again."), { usage });
  }
}
