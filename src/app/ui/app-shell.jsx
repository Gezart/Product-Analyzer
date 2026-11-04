import Link from "next/link";
import { Suspense } from "react";
import { NAV, navLinkClass } from "@/lib/nav";
import { NavLinks } from "./nav-links";

/**
 * The app's frame from the design: the "Unstuck" menu on the left (a scrolling row on a phone) and the
 * page beside it, at most 1060px wide.
 */
export function AppShell({ children }) {
  return (
    <div className="flex min-h-screen flex-col items-stretch bg-canvas md:flex-row md:items-start">
      <nav aria-label="Unstuck" className="flex shrink-0 flex-col gap-0.5 px-3 pt-5 md:sticky md:top-0 md:w-[232px] md:pb-5">
        <div className="flex items-center gap-2 px-2.5 pt-1 pb-4">
          <span aria-hidden="true" className="grid h-[26px] w-[26px] place-items-center rounded-[7px] bg-ink text-sm font-bold text-white">
            U
          </span>
          <span className="text-base font-bold">Unstuck</span>
        </div>
        {/* The current page is known on the client (from the URL); until then no item is marked. */}
        <Suspense
          fallback={
            <ul className="m-0 flex list-none gap-0.5 overflow-x-auto p-0 pb-1 md:flex-col md:overflow-visible md:pb-0">
              {NAV.map((n) => (
                <li key={n.href} className="shrink-0">
                  <Link href={n.href} className={navLinkClass(false)}>
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
          }
        >
          <NavLinks />
        </Suspense>
      </nav>
      <main className="flex min-w-0 flex-1 flex-col gap-4 px-4 pt-4 pb-14 md:max-w-[1060px] md:px-7 md:pt-6">{children}</main>
    </div>
  );
}
