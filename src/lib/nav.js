// The app's menu (the owner's design). Pure, so node:test can load it.

/** The design's menu, in its order; a page is listed once its feature is built. */
export const NAV = [
  { label: "Dashboard", href: "/" },
  { label: "Products", href: "/products" },
  { label: "Inbox", href: "/inbox" },
  { label: "Results", href: "/results" },
  { label: "Collections", href: "/collections" },
  { label: "Compare", href: "/compare" },
  { label: "Reports", href: "/reports" },
  { label: "Plans", href: "/plans" },
  { label: "Settings", href: "/settings" },
];

/** The menu item a path belongs to (a product's page to Products, the weekly plan to Inbox), or null. */
export function activeHref(pathname) {
  if (!pathname || pathname === "/") return "/";
  if (pathname === "/plan" || pathname.startsWith("/plan/")) return "/inbox";
  return NAV.find((n) => n.href !== "/" && (pathname === n.href || pathname.startsWith(`${n.href}/`)))?.href ?? null;
}

/** A menu item's look: the current page white and bold, the rest muted (the design). */
export const navLinkClass = (current) =>
  current
    ? "block rounded-lg bg-white px-2.5 py-2 text-sm font-semibold text-ink no-underline shadow-[0_1px_0_rgba(26,26,26,0.08)] hover:text-ink"
    : "block rounded-lg px-2.5 py-2 text-sm font-medium text-ink-2 no-underline hover:bg-white/60 hover:text-ink";
