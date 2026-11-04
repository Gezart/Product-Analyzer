"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { BTN, CARD, H2, KICKER, Notice, PageHeader } from "@/app/ui/kit";
import { kindOf, lastWeekLines, planRow, whenLabel } from "@/lib/inbox";
import { moneyFormatter } from "@/lib/status-info";

const TONES = {
  good: "bg-[#D1FAE5] text-[#047857]",
  info: "bg-accent-soft text-accent",
  warn: "bg-[#FEF3C7] text-[#B45309]",
  bad: "bg-[#FEE2E2] text-[#B91C1C]",
};
const ICONS = {
  check: "M20 6L9 17l-5-5",
  tag: "M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z",
  alert: "M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  chart: "M3 3v18h18M7 14l4-4 4 4 5-6",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  pause: "M10 4H6v16h4zM18 4h-4v16h4z",
  calendar: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
  bell: "M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 21h4",
};
const mondayLabel = (key) => new Date(`${key}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
const weekLabel = (key) => `Week of ${new Date(`${key}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;

/** The inbox (the owner's design): this week's plan on top, then everything the app did or found. */
export function InboxPage() {
  const router = useRouter();
  const params = useSearchParams();
  const week = params.get("week") ?? "";
  const [plan, setPlan] = useState(null);
  const [planError, setPlanError] = useState(null);
  const [inbox, setInbox] = useState(null);
  const [inboxError, setInboxError] = useState(null);
  const [marking, setMarking] = useState(false);

  useEffect(() => {
    let live = true;
    setPlanError(null);
    fetch(`/api/weekly-plan${week ? `?week=${encodeURIComponent(week)}` : ""}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`);
        if (live) setPlan(body);
      })
      .catch((e) => live && setPlanError(e.message));
    return () => {
      live = false;
    };
  }, [week]);

  const loadInbox = useCallback(async () => {
    const res = await fetch("/api/notifications").catch(() => null);
    if (!res?.ok) return setInboxError(res ? String(res.status) : "network");
    setInbox(await res.json());
    setInboxError(null);
  }, []);
  useEffect(() => {
    loadInbox();
  }, [loadInbox]);

  const markRead = (body) => fetch("/api/notifications/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  async function open(item) {
    if (!item.read) await markRead({ ids: [item.id] }).catch(() => {});
    router.push(item.href);
  }

  async function markAll() {
    setMarking(true);
    await markRead({ all: true }).catch(() => {});
    await loadInbox();
    setMarking(false);
  }

  return (
    <>
      <PageHeader
        title="Inbox"
        subtitle="Your weekly plan and everything the app did or found."
        actions={
          <button type="button" disabled={!inbox || inbox.unread === 0 || marking} onClick={markAll} className={`${BTN.secondary} cursor-pointer`}>
            {marking ? "Marking…" : "Mark all as read"}
          </button>
        }
      />
      <WeeklyPlan data={plan} error={planError} week={week} onWeek={(w) => router.replace(`/inbox?week=${w}`)} />
      <Notifications data={inbox} error={inboxError} onOpen={open} />
    </>
  );
}

/** This week's moves, ranked by money at stake, with last week's results underneath. */
function WeeklyPlan({ data, error, week, onWeek }) {
  const shell = (children) => (
    <section aria-labelledby="plan" className="flex flex-col gap-3.5 rounded-xl border border-accent-line bg-white px-[22px] py-5">
      {children}
    </section>
  );
  if (error) return shell(<Notice tone="bad" compact>Could not load the weekly plan ({error}).</Notice>);
  if (!data) return shell(<p className="m-0 text-[13px] text-muted">Loading the weekly plan…</p>);
  const plan = data.plan;
  const money = moneyFormatter(data.currency);
  if (!plan) {
    return shell(
      <>
        <p className={KICKER}>Weekly plan</p>
        <h2 id="plan" className="m-0 text-lg font-bold">
          {week && data.weeks.length > 0 ? "No plan is kept for that week" : "No plan yet"}
        </h2>
        <p className="m-0 text-[13px] text-muted">
          {week && data.weeks.length > 0 ? (
            <Link href="/inbox">See the latest plan</Link>
          ) : (
            "Every Monday the most useful things to do that week show up here, ranked by money at stake."
          )}
        </p>
      </>,
    );
  }
  const rows = plan.actions.map((a) => ({ ...planRow(a, money), key: `${a.kind}-${a.productId}` }));
  const lines = lastWeekLines(plan.lastWeek, money);
  return shell(
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className={KICKER}>Weekly plan · {mondayLabel(plan.week)}</p>
          <h2 id="plan" className="mt-1 mb-0 text-lg font-bold">
            {rows.length === 0 ? "Nothing urgent this week" : `${rows.length} move${rows.length === 1 ? "" : "s"} for this week`}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-muted">Ranked by money at stake</span>
          {data.weeks.length > 1 && (
            <select aria-label="Week" value={plan.week} onChange={(e) => onWeek(e.target.value)} className="rounded-lg border border-line-strong bg-white px-2 py-1 font-[inherit] text-[13px]">
              {data.weeks.map((w) => (
                <option key={w} value={w}>
                  {weekLabel(w)}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
      {rows.length > 0 && (
        <ol className="m-0 flex list-none flex-col p-0">
          {rows.map((r, i) => (
            <li key={r.key} className="flex flex-wrap items-center gap-3 border-t border-hair py-[11px]">
              <span aria-hidden="true" className="grid h-6 w-6 flex-none place-items-center rounded-md bg-accent-soft text-xs font-bold text-accent">
                {i + 1}
              </span>
              <span className="flex min-w-0 flex-[1_1_180px] flex-col">
                <span className="font-semibold">{r.title}</span>
                {r.why && <span className="text-[13px] text-muted">{r.why}</span>}
              </span>
              <Link href={r.href} className={BTN.small}>
                {r.cta}
              </Link>
            </li>
          ))}
        </ol>
      )}
      {lines.length > 0 && (
        <div className="rounded-[10px] bg-head px-3.5 py-3">
          <p className="mt-0 mb-1.5 font-bold">Last week</p>
          <ul className="m-0 flex list-disc flex-col gap-[3px] pl-[18px] text-ink-2">
            {lines.map((l, i) => (
              <li key={i}>
                {l.before}
                {l.strong && <strong>{l.strong}</strong>}
                {l.product && <Link href={`/products/${l.product.productId}`}>{l.product.title}</Link>}
                {l.after}
                {l.products && (
                  <span className="text-muted">
                    {" "}
                    (
                    {l.products.map((p, j) => (
                      <span key={p.productId}>
                        {j > 0 && ", "}
                        <Link href={`/products/${p.productId}`}>{p.title}</Link>
                      </span>
                    ))}
                    )
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>,
  );
}

/** Everything the app did or found, newest first; opening one marks it read. */
function Notifications({ data, error, onOpen }) {
  return (
    <section aria-labelledby="all" className={`${CARD} overflow-hidden`}>
      <h2 id="all" className={`${H2} px-5 pt-4 pb-2.5`}>
        Notifications{data?.unread > 0 ? ` · ${data.unread} unread` : ""}
      </h2>
      {error && (
        <div className="px-5 pb-4">
          <Notice tone="bad" compact>
            Could not load the inbox ({error}).
          </Notice>
        </div>
      )}
      {!data && !error && <p className="m-0 px-5 pb-4 text-[13px] text-muted">Loading…</p>}
      {data?.items.length === 0 && <p className="m-0 px-5 pb-4 text-[13px] text-muted">Nothing here yet. Results of fixes, markdown updates and products that need attention show up here.</p>}
      {data?.items.length > 0 && (
        <ul className="m-0 list-none p-0">
          {data.items.map((item) => {
            const kind = kindOf(item.type, item.verdict);
            return (
              <li key={item.id} className="border-t border-hair">
                <button
                  type="button"
                  onClick={() => onOpen(item)}
                  className={`flex w-full cursor-pointer items-start gap-3 border-0 px-5 py-3 text-left font-[inherit] text-ink hover:bg-head ${item.read ? "bg-white" : "bg-[#F8F9FF]"}`}
                >
                  <span aria-hidden="true" className={`grid h-8 w-8 flex-none place-items-center rounded-lg ${TONES[kind.tone]}`}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d={ICONS[kind.icon] ?? ICONS.bell} />
                    </svg>
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-px">
                    <span className="flex flex-wrap items-baseline gap-1.5">
                      {!item.read && <span className="sr-only">Unread: </span>}
                      <span className="font-semibold">{item.title}</span>
                      <span className="text-xs text-muted">{kind.label}</span>
                      {!item.read && <span aria-hidden="true" className="h-1.5 w-1.5 self-center rounded-full bg-accent" />}
                    </span>
                    {item.body && <span className="text-[13px] text-ink-2">{item.body}</span>}
                  </span>
                  <span className="text-xs whitespace-nowrap text-muted">{whenLabel(item.createdAt)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
