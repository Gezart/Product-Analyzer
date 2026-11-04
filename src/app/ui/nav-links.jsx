"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { activeHref, NAV, navLinkClass } from "@/lib/nav";

/** The menu items, with the current page marked. */
export function NavLinks() {
  const active = activeHref(usePathname());
  return (
    <ul className="m-0 flex list-none gap-0.5 overflow-x-auto p-0 pb-1 md:flex-col md:overflow-visible md:pb-0">
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
