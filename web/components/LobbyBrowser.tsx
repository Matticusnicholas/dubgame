"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getBrowserClient } from "@/lib/supabase-browser";
import { PACK_CATALOG } from "@/lib/game-state";

interface LobbyEntry {
  code: string;
  package: string;
  title: string | null;
  total_rounds: number;
  created_at: string;
  player_count: number;
}

export function LobbyBrowser() {
  const router = useRouter();
  const [lobbies, setLobbies] = useState<LobbyEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const res = await fetch("/api/lobbies", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch lobbies");
      const data = await res.json();
      setLobbies(data.lobbies ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  // Initial load + Realtime subscription so the list stays fresh as games are
  // created/started/ended.
  useEffect(() => {
    void refresh();
    const sb = getBrowserClient();
    const ch = sb
      .channel("public-lobbies")
      .on("postgres_changes", { event: "*", schema: "public", table: "games" }, () => {
        void refresh();
      })
      .subscribe();
    return () => {
      void sb.removeChannel(ch);
    };
  }, []);

  if (lobbies === null) {
    return null; // first load — keep silent
  }

  return (
    <section className="w-full max-w-3xl">
      <header className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold flex items-center gap-2">
          🌐 Public lobbies
          <span className="text-xs font-normal opacity-50">live</span>
        </h2>
        {lobbies.length > 0 && <span className="text-xs opacity-50">{lobbies.length} open</span>}
      </header>

      {error && <p className="text-sm text-red-400 mb-2">{error}</p>}

      {lobbies.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-center text-sm opacity-60">
          No public games right now. <span className="opacity-100">Be the first to host one — check the &ldquo;🌐 Public lobby&rdquo; box above.</span>
        </div>
      ) : (
        <ul className="grid gap-2">
          {lobbies.map((lob) => {
            const pack = PACK_CATALOG.find((p) => p.id === lob.package);
            return (
              <li key={lob.code}>
                <button
                  onClick={() => {
                    // Send player to home with code prefilled (existing flow handles join)
                    const url = new URL(window.location.href);
                    url.searchParams.set("code", lob.code);
                    router.push(url.pathname + url.search);
                    // Scroll to the join card so the nickname input is visible
                    requestAnimationFrame(() => {
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    });
                  }}
                  className="w-full flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-4 py-3 text-left transition"
                >
                  <div className="flex flex-col min-w-0">
                    <span className="font-bold truncate">
                      {lob.title || pack?.label || "Untitled lobby"}
                    </span>
                    <span className="text-xs opacity-60 mt-0.5">
                      {pack?.label ?? lob.package} · {lob.total_rounds} rounds
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs opacity-60">
                      {lob.player_count} {lob.player_count === 1 ? "player" : "players"}
                    </span>
                    <span className="font-mono tracking-widest text-base font-bold">{lob.code}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
