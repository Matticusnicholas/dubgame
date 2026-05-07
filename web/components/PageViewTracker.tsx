"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { trackPageView } from "@/lib/track";

/**
 * Mounts in the root layout — fires `page_view` on first load and on every
 * client-side navigation (App Router pushState).
 */
export function PageViewTracker() {
  const pathname = usePathname();
  const search = useSearchParams();

  useEffect(() => {
    trackPageView();
  }, [pathname, search]);

  return null;
}
