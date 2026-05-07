"use client";

// Lightweight wrapper around analytics events that sends to BOTH Vercel
// Analytics (when it works) AND our own /api/events endpoint, so we always
// have data even if Vercel's pipeline is broken / blocked / disabled.

import { track as vercelTrack } from "@vercel/analytics";

const SESSION_KEY = "analytics_session_id";

function getSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return "anon";
  }
}

type Primitive = string | number | boolean | null;

export function track(eventName: string, props: Record<string, Primitive> = {}): void {
  // Vercel — best-effort, swallow errors.
  try { vercelTrack(eventName, props); } catch { /* ignore */ }

  // Our own endpoint — fire-and-forget, ignore errors.
  if (typeof window === "undefined") return;
  const body = JSON.stringify({
    event_name: eventName,
    props,
    path: window.location.pathname + window.location.search,
    referrer: document.referrer || undefined,
    session_id: getSessionId(),
  });
  // sendBeacon is preferred during page-unload events; falls back to fetch.
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      const ok = navigator.sendBeacon("/api/events", blob);
      if (ok) return;
    }
  } catch { /* fall through */ }
  fetch("/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => { /* ignore */ });
}

export function trackPageView() {
  track("page_view");
}
