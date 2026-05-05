"use client";

import { createClient, SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function getBrowserClient(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set");
  }
  cached = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 10 } },
  });
  return cached;
}

export function clipPublicUrl(filePath: string): string {
  // Bypass Supabase Storage if the file_path is already a full URL or absolute web path
  // (set by `seed:clips --local`, which copies clips into web/public/clips).
  if (/^https?:\/\//.test(filePath) || filePath.startsWith("/")) return filePath;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const bucket = process.env.NEXT_PUBLIC_CLIPS_BUCKET || "clips";
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  return `${url.replace(/\/+$/, "")}/storage/v1/object/public/${bucket}/${filePath.replace(/^\/+/, "")}`;
}
