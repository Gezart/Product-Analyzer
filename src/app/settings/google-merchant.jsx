"use client";

import { useCallback, useEffect, useState } from "react";
import { apiError } from "@/app/api-error";
import { BTN, Notice, UpgradeNotice } from "@/app/ui/kit";

const day = (iso) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const LINK_BUTTON = "cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-[13px] font-semibold disabled:cursor-default disabled:opacity-50";

/**
 * Google Merchant Center inside the Market price card (the owner's design): connect (Google's consent
 * screen opens in a new window), choose the account when there are several, read now, disconnect.
 * Google's benchmark prices then show on product pages.
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

  if (error) return <Notice tone="bad" compact>Could not load the Google connection: {error}</Notice>;
  if (!data) return <p className="m-0 text-[13px] text-muted">Loading the Google connection…</p>;

  const disconnect = (
    <button type="button" disabled={busy !== null} onClick={() => update("DELETE", null, "disconnect")} className={`${BTN.small} cursor-pointer`}>
      {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
    </button>
  );
  const connected = data.status === "connected" || data.status === "failed";
  // The design's connection row: a dot, what it is and its state, and its action on the right.
  const dot = data.status === "connected" ? "bg-[#059669]" : data.status === "failed" ? "bg-[#DC2626]" : data.status === "choose_account" ? "bg-[#D97706]" : "bg-line-strong";
  const state =
    data.status === "connected" ? "connected" : data.status === "failed" ? "needs attention" : data.status === "choose_account" ? "choose an account" : "not connected";
  const detail = data.upgrade
    ? "Not read on your plan."
    : !data.configured
      ? "Not available yet: the app's Google access is still being set up."
      : data.status === "connected"
        ? `${data.accountName ? `Account "${data.accountName}"${data.accountId ? ` (${data.accountId})` : ""} · ` : ""}${
            data.syncedAt ? `read ${day(data.syncedAt)} · ${data.benchmarks} product price${data.benchmarks === 1 ? "" : "s"} with a Google benchmark` : "the benchmarks are being read; this can take a few minutes"
          }`
        : data.status === "failed"
          ? `${data.accountName ? `Account "${data.accountName}"` : "The connection"} stopped working.`
          : data.status === "choose_account"
            ? "Choose the Merchant Center account your products are in."
            : "See what shoppers pay on average for your products on Google. Products need to sell on Google through Shopify's Google & YouTube app.";

  return (
    <div id="google" className="flex scroll-mt-4 flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-line px-3.5 py-3">
        <div className="flex min-w-0 flex-[1_1_320px] items-center gap-2.5">
          <span aria-hidden="true" className={`h-2.5 w-2.5 flex-none rounded-full ${dot}`} />
          <div className="min-w-0">
            <p className="m-0 font-semibold">Google Merchant Center · {state}</p>
            <p className="m-0 text-[13px] text-muted">{detail}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!data.upgrade && data.configured && data.status === "not_connected" && (
            <button type="button" disabled={busy !== null} onClick={connect} className={`${BTN.smallPrimary} cursor-pointer`}>
              {busy === "connect" ? "Opening Google…" : "Connect"}
            </button>
          )}
          {!data.upgrade && data.status === "failed" && data.configured && (
            <button type="button" disabled={busy !== null} onClick={connect} className={`${BTN.smallPrimary} cursor-pointer`}>
              {busy === "connect" ? "Opening Google…" : "Connect again"}
            </button>
          )}
          {!data.upgrade && data.status === "connected" && (
            <button type="button" disabled={busy !== null} onClick={() => update("POST", { action: "sync" }, "sync")} className={`${BTN.small} cursor-pointer`}>
              {busy === "sync" ? "Reading…" : "Read now"}
            </button>
          )}
          {/* Below the plan nothing is read, but a merchant can always take Google's access back. */}
          {data.status !== "not_connected" && disconnect}
        </div>
      </div>
      {data.upgrade && <UpgradeNotice>Google&apos;s benchmark prices are included from the Starter plan.</UpgradeNotice>}
      {message && <Notice tone="bad" compact>{message}</Notice>}
      {!data.upgrade && data.error && <Notice tone={data.status === "failed" ? "bad" : "warn"} compact>{data.error}</Notice>}
      {!data.upgrade && waiting && data.status === "not_connected" && <p className="m-0 text-[13px] text-muted">Finish in Google&apos;s window, then come back here.</p>}
      {!data.upgrade && data.status === "choose_account" && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-col gap-1 text-[13px] font-semibold">
            Account
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="rounded-lg border border-line-strong bg-white px-2.5 py-2 font-[inherit] font-normal">
              <option value="">Choose…</option>
              {(data.accounts ?? []).map((a) => (
                <option key={a.accountId} value={a.accountId}>
                  {a.accountName} ({a.accountId})
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={!accountId || busy !== null} onClick={() => update("POST", { action: "account", accountId }, "account")} className={`${BTN.small} cursor-pointer`}>
            {busy === "account" ? "Saving…" : "Use this account"}
          </button>
          {data.configured && (
            <button type="button" disabled={busy !== null} onClick={connect} className={`${LINK_BUTTON} text-accent`}>
              Connect another Google account
            </button>
          )}
        </div>
      )}
      {connected && data.status === "connected" && <p className="m-0 text-xs text-muted">Read again every night.</p>}
    </div>
  );
}
