"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/** "N new in your inbox" on the home page, only when something is unread. */
export function InboxBanner() {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    fetch("/api/notifications")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => body && setUnread(body.unread))
      .catch(() => {});
  }, []);
  if (!unread) return null;
  return (
    <s-banner tone="info">
      <Link href="/inbox" className="hover:underline">
        {unread} new in your inbox
      </Link>
    </s-banner>
  );
}
