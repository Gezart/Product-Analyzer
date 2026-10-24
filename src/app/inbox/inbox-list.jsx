"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { listen } from "@/app/polaris-events";

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
  if (data.items.length === 0) {
    return (
      <s-section>
        <s-paragraph>Nothing yet. Results of fixes, markdown updates and products that need attention show up here.</s-paragraph>
      </s-section>
    );
  }

  return (
    <s-section>
      <s-stack gap="base">
        {data.unread > 0 && (
          <div>
            <s-button ref={listen("click", async () => (await markRead({ all: true }).catch(() => {}), load()))}>Mark all as read</s-button>
          </div>
        )}
        <ul className="m-0 list-none divide-y divide-zinc-200 p-0">
          {data.items.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => open(item)} className="flex w-full gap-3 py-3 text-left hover:bg-zinc-50">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.read ? "bg-transparent" : "bg-blue-600"}`} aria-hidden="true" />
                <span className="flex-1">
                  {!item.read && <span className="sr-only">Unread: </span>}
                  <span className={`block text-sm ${item.read ? "text-zinc-700" : "font-semibold text-zinc-900"}`}>{item.title}</span>
                  {item.body && <span className="block text-sm text-zinc-600">{item.body}</span>}
                  <span className="block text-xs text-zinc-500">{new Date(item.createdAt).toLocaleString()}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </s-stack>
    </s-section>
  );
}
