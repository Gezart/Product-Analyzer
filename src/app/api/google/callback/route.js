import { callbackStore, cancelConnect, finishConnect, GoogleError } from "@/lib/google-merchant";

// Google sends the merchant back here after its consent screen (a new window, outside Shopify admin, so
// there is no Shopify session: the single-use state names the store). Nothing is stored until the
// merchant confirms the store shown on the page, so a consent link sent by someone else can't connect
// the merchant's Google account to another store.

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function page(title, body) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escape(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#1a1a1a}p{color:#4a4a4a;line-height:1.5}button{font:inherit;padding:.6rem 1.1rem;border-radius:.5rem;border:0;background:#1a1a1a;color:#fff;cursor:pointer}</style></head>
<body><h1>${escape(title)}</h1>${body}</body></html>`;
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    },
  });
}

const done = (title, text) => page(title, `<p>${escape(text)}</p><p>You can close this window and go back to the app.</p>`);

function failed(error) {
  if (error instanceof GoogleError) return done("Google wasn't connected", error.message);
  console.error("[google] callback", error);
  return done("Google wasn't connected", "Something went wrong. Try again from the app's Settings.");
}

// Back from Google: show which store will be connected, and ask to confirm.
export async function GET(request) {
  const params = new URL(request.url).searchParams;
  try {
    if (params.get("error")) await cancelConnect(params.get("state"), params.get("error"));
    const store = await callbackStore(params.get("state"));
    return page(
      "Connect Google Merchant Center?",
      `<p>Your Google account's Merchant Center will be connected to the store <strong>${escape(store)}</strong>. The app reads Google's price benchmarks for its products.</p>
<p>Not your store? Close this window and nothing is connected.</p>
<form method="post"><input type="hidden" name="state" value="${escape(params.get("state"))}"><input type="hidden" name="code" value="${escape(params.get("code") ?? "")}"><button type="submit">Connect to ${escape(store)}</button></form>`,
    );
  } catch (error) {
    return failed(error);
  }
}

// The merchant confirmed: the code becomes the store's Google access.
export async function POST(request) {
  try {
    const form = await request.formData();
    const { status } = await finishConnect({ state: form.get("state"), code: form.get("code") });
    if (status === "choose_account") return done("Google is connected", "Choose which Merchant Center account to use in the app's Settings.");
    if (status === "failed") return done("No Merchant Center account", "This Google account has no Merchant Center account. Connect with the Google account that manages your Merchant Center.");
    return done("Google is connected", "Google's price benchmarks are read in a few minutes and every night after, for products that sell on Google.");
  } catch (error) {
    return failed(error);
  }
}
