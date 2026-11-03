// AI product descriptions: what Claude is asked, the answer's shape, and what's safe to put in Shopify.
// Pure (no imports) so node:test can load it.

export const AI_TEXT_MODEL = "claude-opus-5-5";
/** Claude Opus 5.5 list prices per token (USD): $4 / $20 per million input / output tokens. */
const INPUT_USD = 4 / 1_000_000;
const OUTPUT_USD = 20 / 1_000_000;
export const MAX_IMAGES = 4;

/** The answer's shape (structured output): the page text, SEO and the facts left to the merchant. */
export const DESCRIPTION_SCHEMA = {
  type: "object",
  properties: {
    description_html: { type: "string", description: "The product description as simple HTML." },
    seo_title: { type: "string", description: "SEO title, at most 60 characters." },
    seo_description: { type: "string", description: "Meta description, at most 155 characters." },
    fill_in: { type: "array", items: { type: "string" }, description: "Each [fill in: …] placeholder used, e.g. \"material\"." },
  },
  required: ["description_html", "seo_title", "seo_description", "fill_in"],
  additionalProperties: false,
};

export const DESCRIPTION_SYSTEM = `You write product descriptions for an online store on Shopify.

Write in the language of the product's title and current description; if that's unclear, write in English.

Never invent facts. Use only the product data you're given and what is plainly visible in the photos (such as color or shape). Anything a shopper needs that you don't know for sure (material, dimensions, size and fit, care, origin, what's included) goes in as a placeholder the merchant fills in, written exactly as [fill in: what's missing], for example [fill in: material]: keep the words "fill in" in English whatever language you write in, and use square brackets for nothing else. List every placeholder you used in fill_in.

The description: 120 to 250 words of simple HTML using only <p>, <ul>, <li>, <strong> and <em>. Say what it is and who it's for, then a short list of the key details (size or dimensions, material, how to use or care for it), then why it's worth it. Plain, specific and honest: no exaggeration, no claims you can't back.

The SEO title: at most 60 characters, the product's name and what it is. The meta description: at most 155 characters, what it is and why to buy it.`;

/** What the diagnosis found wrong with the page, said so the draft fixes it. */
const PROBLEMS = {
  short_description: "the description is too short",
  missing_details: "the description doesn't mention size or dimensions, material, or use and care",
  duplicate_description: "the description is copied from other products, so write one of its own",
  missing_seo: "the SEO title or meta description is missing",
};

/**
 * The request text from the product: its title, type, vendor, variants (option names and values), tags,
 * current description (plain text) and what the diagnosis found. Photos go in as images beside it.
 */
export function descriptionPrompt(product, reasonCodes = []) {
  const options = new Map();
  for (const v of product.variants ?? []) {
    for (const [name, value] of Object.entries(v.options ?? {})) {
      if (!value || value === "Default Title") continue;
      options.set(name, new Set([...(options.get(name) ?? []), value]));
    }
  }
  const lines = [
    `Title: ${product.title}`,
    product.productType && `Product type: ${product.productType}`,
    product.vendor && `Brand or vendor: ${product.vendor}`,
    ...[...options].map(([name, values]) => `${name}: ${[...values].join(", ")}`),
    product.tags?.length ? `Tags: ${product.tags.filter((t) => !/^season\s*:/i.test(t)).join(", ")}` : null,
    `Current description: ${product.description?.trim() ? product.description.trim().slice(0, 3000) : "(none)"}`,
  ].filter(Boolean);
  const problems = reasonCodes.map((c) => PROBLEMS[c]).filter(Boolean);
  if (problems.length) lines.push(`What to fix: ${problems.join("; ")}.`);
  lines.push("Write the new description, SEO title and meta description.");
  return lines.join("\n");
}

const ALLOWED_TAGS = new Set(["p", "ul", "ol", "li", "strong", "em", "b", "i", "br", "h3", "h4"]);
const TAG = /<\s*(\/?)\s*([a-z][a-z0-9]*)\b[^<>]*>/gi;
const escapeText = (t) => t.replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Removes `pattern` until nothing matches (so removed pieces can't join into a new match). */
function removeAll(text, pattern) {
  let out = text;
  for (let before = null; before !== out; ) {
    before = out;
    out = out.replace(pattern, "");
  }
  return out;
}

/**
 * Only simple tags, without attributes, reach Shopify: scripts, styles, links, images and every
 * attribute (onclick, style, href) are dropped; their text stays (except inside script/style). Text
 * between tags is escaped, so pieces of removed tags can never form a new tag.
 */
export function cleanDescriptionHtml(html) {
  let text = removeAll(String(html ?? ""), /<!--[\s\S]*?-->/g);
  text = removeAll(text, /<\s*(script|style|iframe|object|embed|template)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi);
  let out = "";
  let last = 0;
  for (const m of text.matchAll(TAG)) {
    out += escapeText(text.slice(last, m.index));
    const tag = m[2].toLowerCase();
    if (ALLOWED_TAGS.has(tag)) out += `<${m[1]}${tag}>`;
    last = m.index + m[0].length;
  }
  return (out + escapeText(text.slice(last))).trim();
}

/** A placeholder: `[fill in: material]` (also without the colon or the closing bracket). */
const FILL_IN = /\[\s*fill[\s-]*in\b\s*:?\s*([^\]<\n]*)\]?/gi;

/** The [fill in: …] placeholders still in a text, for the merchant to finish before applying. */
export function fillInsLeft(...texts) {
  const found = new Set();
  for (const t of texts) for (const m of String(t ?? "").matchAll(FILL_IN)) found.add(m[1].trim() || "the missing detail");
  return [...found];
}

/**
 * In the AI's draft every bracketed part is a placeholder (the prompt asks for no other brackets): one
 * written another way (`[à compléter : matière]`) becomes `[fill in: à compléter : matière]`, so it's
 * found and blocks Apply like the others.
 */
const markPlaceholders = (text) => String(text ?? "").replace(/\[([^\]\n]{1,120})\]/g, (all, inner) => (/^\s*fill[\s-]*in\b/i.test(inner) ? all : `[fill in: ${inner.trim()}]`));

/** What a request cost, from the API's usage (cached input billed as input: an upper bound). */
export function requestCostUsd(usage) {
  const input = (usage?.input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0);
  return Math.round((input * INPUT_USD + (usage?.output_tokens ?? 0) * OUTPUT_USD) * 10000) / 10000;
}

/** The draft from Claude's JSON answer, cleaned, with its placeholders listed; null when it isn't usable. */
export function draftFromAnswer(json) {
  if (!json || typeof json.description_html !== "string" || !json.description_html.trim()) return null;
  const html = markPlaceholders(cleanDescriptionHtml(json.description_html));
  // Not cut to Shopify's limits (70 / 320): a cut could break a placeholder. The editor shows the
  // length and Apply waits until it fits.
  const seoTitle = markPlaceholders(json.seo_title).trim();
  const seoDescription = markPlaceholders(json.seo_description).trim();
  const fillIn = fillInsLeft(html, seoTitle, seoDescription);
  // The AI says it left details open but didn't mark them in the text: mark them, so they're checked.
  const listed = (Array.isArray(json.fill_in) ? json.fill_in : []).map((f) => String(f).trim()).filter(Boolean);
  if (!fillIn.length && listed.length) {
    return { descriptionHtml: `${html}\n<p>[fill in: ${listed.join(", ")}]</p>`, seoTitle, seoDescription, fillIn: [listed.join(", ")] };
  }
  return { descriptionHtml: html, seoTitle, seoDescription, fillIn };
}
