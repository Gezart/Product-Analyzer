"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiError } from "@/app/api-error";
import { Card, Notice, PageHeader, Pill, TH, THEAD, TROW } from "@/app/ui/kit";
import { CHECKPOINTS, NEXT_STEP, STATUS } from "@/lib/launches";
import { moneyFormatter } from "@/lib/status-info";

const SUBTITLE = "New products in their first 30 days, against your store. Catch a launch that isn't working early.";

const pct = (rate) => (rate == null ? "—" : `${(rate * 100).toFixed(1)}%`);

/** Where to act on a launch: the fix center for a page problem, collections for few visits, else the product. */
function nextLink(launch) {
  if (launch.status === "page_problem") return { href: `/products/${launch.id}/fix`, label: "Fix the page" };
  if (launch.status === "no_traffic") return { href: "/collections", label: "Collections" };
  return { href: `/products/${launch.id}`, label: "Open" };
}

/** Day 7, 14 and 30: the status recorded at each, or the day it comes. */
function Checkpoints({ launch }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {CHECKPOINTS.map((day) => {
        const check = launch.checks.find((c) => c.day === day);
        if (check) {
          return (
            <span key={day} title={check.reason ?? ""}>
              <Pill tone={STATUS[check.status]?.tone}>
                Day {day}: {STATUS[check.status]?.label ?? check.status}
              </Pill>
            </span>
          );
        }
        return (
          <span key={day} className="text-xs text-muted">
            Day {day}
            {launch.day < day ? ` in ${day - launch.day}d` : ""}
          </span>
        );
      })}
    </span>
  );
}

/** Launches: every product created in the last 30 days with its numbers so far and how it compares. */
export function LaunchesView() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/launches")
      .then(async (res) => {
        if (!res.ok) throw await apiError(res);
        setData(await res.json());
      })
      .catch((e) => setError(e.message));
  }, []);

  const money = moneyFormatter(data?.currency, 0);
  const attention = data?.launches.filter((l) => l.status === "page_problem" || l.status === "no_traffic").length ?? 0;

  return (
    <>
      <PageHeader title="Launches" subtitle={SUBTITLE} />
      {error && <Notice tone="bad">{error}</Notice>}
      {!data && !error && <p className="m-0 text-muted">Loading your launches…</p>}

      {data && (
        <>
          <div className="flex flex-wrap gap-3">
            <Card className="min-w-[180px] flex-1 px-5 py-4">
              <span className="text-xs font-semibold text-muted">Launched in 30 days</span>
              <span className="block text-2xl font-bold">{data.launches.length}</span>
            </Card>
            <Card className="min-w-[180px] flex-1 px-5 py-4">
              <span className="text-xs font-semibold text-muted">Need attention</span>
              <span className={`block text-2xl font-bold ${attention ? "text-[#B91C1C]" : ""}`}>{attention}</span>
            </Card>
            <Card className="min-w-[180px] flex-1 px-5 py-4">
              <span className="text-xs font-semibold text-muted">Your store&apos;s add-to-cart rate</span>
              <span className="block text-2xl font-bold">{data.store.viewsKnown ? pct(data.store.cartRate) : "—"}</span>
              <span className="text-xs text-muted">{data.store.viewsKnown ? "Median of your products, last 30 days" : "No visit data yet"}</span>
            </Card>
          </div>

          {data.launches.length === 0 ? (
            <Notice compact>No products were added in the last 30 days. New products show here from their first day.</Notice>
          ) : (
            <Card heading="New products">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[13px]">
                  <thead className={THEAD}>
                    <tr>
                      <th className={TH} scope="col">
                        Product
                      </th>
                      <th className={TH} scope="col">
                        Now
                      </th>
                      <th className={`${TH} text-right`} scope="col">
                        Visits
                      </th>
                      <th className={`${TH} text-right`} scope="col">
                        Added to cart
                      </th>
                      <th className={`${TH} text-right`} scope="col">
                        Sold
                      </th>
                      <th className={TH} scope="col">
                        Checks
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.launches.map((launch) => {
                      const next = nextLink(launch);
                      return (
                        <tr key={launch.id} className={`${TROW} align-top`}>
                          <td className="px-3 py-[9px]">
                            <Link href={`/products/${launch.id}`} className="font-semibold">
                              {launch.title}
                            </Link>
                            <span className="block text-xs text-muted">
                              Day {launch.day} · added {new Date(`${launch.createdOn}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC" })}
                            </span>
                          </td>
                          <td className="max-w-[340px] px-3 py-[9px]">
                            <Pill tone={STATUS[launch.status]?.tone}>{STATUS[launch.status]?.label}</Pill>
                            <span className="mt-1 block text-xs text-muted">{launch.reason}</span>
                            {(launch.status === "page_problem" || launch.status === "no_traffic") && (
                              <span className="mt-1 block text-xs">
                                {NEXT_STEP[launch.status]}{" "}
                                <Link href={next.href} className="font-semibold">
                                  {next.label} →
                                </Link>
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-[9px] text-right tabular-nums">{launch.views.toLocaleString()}</td>
                          <td className="px-3 py-[9px] text-right tabular-nums">{pct(launch.cartRate)}</td>
                          <td className="px-3 py-[9px] text-right tabular-nums">
                            {launch.units.toLocaleString()}
                            <span className="block text-xs text-muted">{money.format(launch.revenue)}</span>
                          </td>
                          <td className="px-3 py-[9px]">
                            <Checkpoints launch={launch} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card heading="How a launch is judged">
            <ul className="m-0 flex flex-col gap-1.5 px-5 pt-0 pb-4 pl-10 text-[13px] text-ink-2">
              <li>Checks on day 7, 14 and 30 after a product is added; the inbox tells you about launches that need attention or start strong.</li>
              <li>
                <strong>Few visits</strong>: under {data.rules.minViews} visits and under a quarter of what a typical product of yours gets in as many days.
              </li>
              <li>
                <strong>Early page problem</strong>: at least {data.rules.minViews} visits, and under half your store&apos;s add-to-cart rate.
              </li>
              <li>
                <strong>Strong start</strong>: 1.5× your store&apos;s add-to-cart rate or more, and a sale.
              </li>
            </ul>
          </Card>
        </>
      )}
    </>
  );
}
