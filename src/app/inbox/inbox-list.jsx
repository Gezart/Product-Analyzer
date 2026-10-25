"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { listen } from "@/app/polaris-events";
import { CARD } from "@/app/status-style";

/** Icon and colors per notification type; unknown types get the neutral bell. */
const KIND = {
  analysis_ready: { icon: "spark", tile: "bg-indigo-100 text-indigo-600" },
  new_attention: { icon: "spark", tile: "bg-amber-100 text-amber-700" },
  rescue_verdict: { icon: "target", tile: "bg-emerald-100 text-emerald-700" },
  markdown_floor_reached: { icon: "tag", tile: "bg-amber-100 text-amber-700" },
  markdown_paused: { icon: "tag", tile: "bg-amber-100 text-amber-700" },
  markdown_unsold: { icon: "tag", tile: "bg-amber-100 text-amber-700" },
  markdown_restore_failed: { icon: "alert", tile: "bg-red-100 text-red-700" },
  price_guard: { icon: "alert", tile: "bg-red-100 text-red-700" },
  monthly_report: { icon: "report", tile: "bg-sky-100 text-sky-700" },
};
const DEFAULT_KIND = { icon: "bell", tile: "bg-zinc-100 text-zinc-600" };

/** Inbox items, newest first; opening one marks it read. */
export function InboxList() {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) throw new Error(String(res.status));
      setData(await res.json());
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const markRead = (body) =>
    fetch("/api/notifications/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  async function open(item) {
    if (!item.read) await markRead({ ids: [item.id] }).catch(() => {});
    router.push(item.href);
  }

  if (error) return <s-banner tone="critical">Could not load the inbox ({error}).</s-banner>;
  if (!data) return <s-spinner accessibilityLabel="Loading inbox" />;
  return (
    <InboxView
      data={data}
      onOpen={open}
      markAllRef={listen("click", async () => (await markRead({ all: true }).catch(() => {}), load()))}
    />
  );
}

/** The inbox list itself; `markAllRef` wires the "Mark all as read" button. */
export function InboxView({ data, onOpen, markAllRef }) {
  if (data.items.length === 0) {
    return (
      <section className={`${CARD} flex flex-col items-center gap-3 px-6 py-12 text-center`}>
        <span aria-hidden="true" className="grid h-12 w-12 place-items-center rounded-2xl bg-indigo-50 text-indigo-600">
          <KindIcon icon="bell" />
        </span>
        <p className="m-0 text-base font-semibold text-zinc-900">Nothing here yet</p>
        <p className="m-0 max-w-sm text-sm text-zinc-500">Results of fixes, markdown updates and products that need attention show up here.</p>
      </section>
    );
  }

  return (
    <section className={`${CARD} overflow-hidden`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-5 py-3.5">
        <p className="m-0 text-sm text-zinc-600">
          {data.unread > 0 ? <span className="font-semibold text-zinc-900">{data.unread} unread</span> : "All caught up"}
        </p>
        {data.unread > 0 && <s-button ref={markAllRef}>Mark all as read</s-button>}
      </div>
      <ul className="m-0 list-none divide-y divide-zinc-100 p-0">
        {data.items.map((item) => {
          const kind = KIND[item.type] ?? DEFAULT_KIND;
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onOpen(item)}
                className={`group flex w-full items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-zinc-50 ${item.read ? "" : "bg-indigo-50/40"}`}
              >
                <span aria-hidden="true" className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${kind.tile}`}>
                  <KindIcon icon={kind.icon} />
                </span>
                <span className="min-w-0 flex-1">
                  {!item.read && <span className="sr-only">Unread: </span>}
                  <span className="flex items-center gap-2">
                    <span className={`block text-sm ${item.read ? "text-zinc-700" : "font-semibold text-zinc-900"}`}>{item.title}</span>
                    {!item.read && <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-indigo-600" />}
                  </span>
                  {item.body && <span className="mt-0.5 block text-sm text-zinc-600">{item.body}</span>}
                  <span className="mt-1 block text-xs text-zinc-500">
                    {new Date(item.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                  </span>
                </span>
                <span aria-hidden="true" className="self-center text-zinc-300 transition group-hover:translate-x-0.5 group-hover:text-zinc-500">
                  →
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function KindIcon({ icon }) {
  const paths = {
    spark: (
      <>
        <path d="M12 3l1.9 4.6 4.6 1.9-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z" />
        <path d="M19 15l.8 1.9 1.9.8-1.9.8L19 20.4l-.8-1.9-1.9-.8 1.9-.8z" />
      </>
    ),
    target: (
      <>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3.5" />
      </>
    ),
    tag: (
      <>
        <path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z" />
        <circle cx="7.5" cy="7.5" r="1.3" />
      </>
    ),
    alert: (
      <>
        <path d="M12 3l9.5 17h-19z" />
        <path d="M12 10v4" />
        <path d="M12 17.5v.01" />
      </>
    ),
    report: (
      <>
        <path d="M6 3h9l4 4v14H6z" />
        <path d="M9 13h6M9 17h4M9 9h3" />
      </>
    ),
    bell: (
      <>
        <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
        <path d="M10 21h4" />
      </>
    ),
  };
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {paths[icon] ?? paths.bell}
    </svg>
  );
}
