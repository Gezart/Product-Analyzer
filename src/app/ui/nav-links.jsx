"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { activeHref, NAV, navLinkClass } from "@/lib/nav";

/** The menu items, with the current page marked. */
export function NavLinks() {
  const active = activeHref(usePathname());
  const list = useRef(null);
  // On a phone the menu is a scrolling row: bring the current page into view.
  useEffect(() => {
    const row = list.current;
    const current = row?.querySelector('[aria-current="page"]');
    if (!row || !current || row.scrollWidth <= row.clientWidth) return;
    row.scrollLeft = Math.max(0, current.offsetLeft - (row.clientWidth - current.offsetWidth) / 2);
  }, [active]);
  return (
    <ul ref={list} className="m-0 flex list-none gap-0.5 overflow-x-auto p-0 pb-1 md:flex-col md:overflow-visible md:pb-0">
      {NAV.map((n) => (
        <li key={n.href} className="shrink-0">
          <Link href={n.href} aria-current={n.href === active ? "page" : undefined} className={navLinkClass(n.href === active)}>
            {n.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
