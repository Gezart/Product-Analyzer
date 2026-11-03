"use client";

import { useCallback, useEffect, useState } from "react";
import { apiError } from "@/app/api-error";
import { listen } from "@/app/polaris-events";
import { UpgradeBanner } from "@/app/upgrade-banner";

const day = (iso) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * Google Merchant Center: connect (Google's consent screen opens in a new window), choose the account when
 * there are several, read now, disconnect. Google's benchmark prices then show on product pages.
 */
export function GoogleMerchant() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);
  const [accountId, setAccountId] = useState("");
  const [waiting, setWaiting] = useState(false);

  const load = useCallback(() => {
    fetch("/api/google")
      .then(async (res) => (res.ok ? setData(await res.json()) : Promise.reject(await apiError(res))))
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  // Back from Google's window: show the new state.
  useEffect(() => {
    if (!waiting) return undefined;
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [waiting, load]);

  async function send(method, body, action) {
    if (busy) return null;
    setBusy(action);
    setMessage(null);
    try {
      const res = await fetch("/api/google", { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
      if (!res.ok) throw await apiError(res);
      return await res.json();
    } catch (e) {
      setMessage(e.message);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function connect() {
    // Opened right away (a window opened after a request is blocked), then pointed at Google.
    const win = window.open("", "_blank");
    const answer = await send("POST", { action: "connect" }, "connect");
    if (!answer?.url) return win?.close();
    if (win) win.location.href = answer.url;
    else window.open(answer.url, "_blank");
    setWaiting(true);
  }

  const update = async (method, body, action) => {
    const answer = await send(method, body, action);
    if (answer) setData(answer);
  };

  if (error) return <s-section heading="Google Merchant Center"><s-banner tone="critical">Could not load the Google connection: {error}</s-banner></s-section>;
  if (!data) return <s-section heading="Google Merchant Center"><s-spinner accessibilityLabel="Loading the Google connection" /></s-section>;

  const intro = <s-text tone="neutral">See what shoppers pay on average for your products on Google, next to your price. Products need to sell on Google through Shopify&apos;s Google &amp; YouTube app.</s-text>;
  const disconnectButton = (
    <s-button variant="tertiary" tone="critical" loading={busy === "disconnect" || undefined} disabled={busy !== null || undefined} ref={listen("click", () => update("DELETE", null, "disconnect"))}>
      Disconnect
    </s-button>
  );
  if (data.upgrade) {
    // Below the plan nothing is read, but a merchant can always take Google's access back.
    return (
      <s-section heading="Google Merchant Center">
        <s-stack gap="small">
          {intro}
          {message && <s-banner tone="critical">{message}</s-banner>}
          <UpgradeBanner>Google&apos;s benchmark prices are included from the Starter plan.</UpgradeBanner>
          {data.status !== "not_connected" && <div>{disconnectButton}</div>}
        </s-stack>
      </s-section>
    );
  }

  return (
    <s-section heading="Google Merchant Center" id="google">
      <s-stack gap="base">
        {intro}
        {message && <s-banner tone="critical">{message}</s-banner>}
        {!data.configured && <s-banner tone="info">Not available yet: the app&apos;s Google access is still being set up.</s-banner>}

        {data.configured && data.status === "not_connected" && (
          <s-stack gap="small">
            {data.error && <s-banner tone="warning">{data.error}</s-banner>}
            <div>
              <s-button variant="primary" loading={busy === "connect" || undefined} ref={listen("click", connect)}>
                Connect Google Merchant Center
              </s-button>
            </div>
            {waiting && <s-text tone="neutral">Finish in Google&apos;s window, then come back here.</s-text>}
          </s-stack>
        )}

        {data.status === "choose_account" && (
          <s-stack gap="small">
            <s-text>Choose the Merchant Center account your products are in.</s-text>
            {data.error && <s-banner tone="warning">{data.error}</s-banner>}
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex min-w-0 flex-col gap-1 text-sm">
                Account
                <select className="rounded-lg border border-zinc-300 bg-white px-3 py-2" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  <option value="">Choose…</option>
                  {(data.accounts ?? []).map((a) => (
                    <option key={a.accountId} value={a.accountId}>
                      {a.accountName} ({a.accountId})
                    </option>
                  ))}
                </select>
              </label>
              <s-button disabled={!accountId || busy !== null || undefined} loading={busy === "account" || undefined} ref={listen("click", () => update("POST", { action: "account", accountId }, "account"))}>
                Use this account
              </s-button>
            </div>
            <div className="flex flex-wrap gap-2">
              {data.configured && (
                <s-button variant="tertiary" loading={busy === "connect" || undefined} disabled={busy !== null || undefined} ref={listen("click", connect)}>
                  Connect another Google account
                </s-button>
              )}
              {disconnectButton}
            </div>
          </s-stack>
        )}

        {(data.status === "connected" || data.status === "failed") && (
          <s-stack gap="small">
            {data.accountName && (
              <s-text>
                Connected to <strong>{data.accountName}</strong> ({data.accountId}).
              </s-text>
            )}
            {data.error && <s-banner tone={data.status === "failed" ? "critical" : "warning"}>{data.error}</s-banner>}
            {data.status === "connected" && (
              <s-text tone="neutral">
                {data.syncedAt
                  ? `${data.benchmarks} product price${data.benchmarks === 1 ? "" : "s"} with a Google benchmark · read ${day(data.syncedAt)}. Read again every night.`
                  : "The benchmarks are being read; this can take a few minutes."}
              </s-text>
            )}
            <div className="flex flex-wrap gap-2">
              {data.status === "failed" && data.configured && (
                <s-button variant="primary" loading={busy === "connect" || undefined} disabled={busy !== null || undefined} ref={listen("click", connect)}>
                  Connect again
                </s-button>
              )}
              {data.status === "connected" && (
                <s-button loading={busy === "sync" || undefined} disabled={busy !== null || undefined} ref={listen("click", () => update("POST", { action: "sync" }, "sync"))}>
                  Read now
                </s-button>
              )}
              {disconnectButton}
            </div>
          </s-stack>
        )}

      </s-stack>
    </s-section>
  );
}
