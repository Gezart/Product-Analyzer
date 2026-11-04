"use client";

import { useEffect, useRef } from "react";

/**
 * Scrolls to the section the URL's #hash names once `ready`, retrying while sections that load their own
 * data appear. `aliases` maps old section names to their new ones.
 */
export function useHashScroll(ready, aliases = {}) {
  const done = useRef(false);
  useEffect(() => {
    if (!ready || done.current || !window.location.hash) return;
    done.current = true;
    const name = decodeURIComponent(window.location.hash.slice(1));
    const id = aliases[name] ?? name;
    // Not cancelled on unmount: a retry after it finds nothing and stops.
    const tryScroll = (tries) => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      else if (tries > 0) setTimeout(() => tryScroll(tries - 1), 300);
    };
    tryScroll(10);
  }, [ready, aliases]);
}
