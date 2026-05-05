"use client";

const KEY = "seen_clip_ids";
const MAX_CACHED = 500;

export function getSeenClipIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function appendSeenClipIds(ids: string[]): void {
  if (typeof window === "undefined" || ids.length === 0) return;
  try {
    const existing = new Set(getSeenClipIds());
    for (const id of ids) existing.add(id);
    let next = Array.from(existing);
    // Cap how big the list can grow so the request body stays small.
    if (next.length > MAX_CACHED) next = next.slice(next.length - MAX_CACHED);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* localStorage quota / privacy mode */
  }
}

export function clearSeenClipIds(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
