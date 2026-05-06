"use client";

import { useEffect, useRef, useState } from "react";
import { getBrowserClient } from "@/lib/supabase-browser";
import { MESSAGE_MAX_LEN, type MessageRow } from "@/lib/game-state";

export function ChatPanel({
  gameId,
  code,
  hostToken,
  playerToken,
  className,
}: {
  gameId: string;
  code: string;
  hostToken?: string | null;
  playerToken?: string | null;
  className?: string;
}) {
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Initial fetch + realtime subscription per game.
  useEffect(() => {
    const sb = getBrowserClient();
    let cancelled = false;
    void sb
      .from("messages")
      .select("*")
      .eq("game_id", gameId)
      .order("created_at", { ascending: true })
      .limit(200)
      .then(({ data }) => {
        if (cancelled) return;
        setMessages((data ?? []) as MessageRow[]);
      });

    const ch = sb
      .channel(`chat-${gameId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `game_id=eq.${gameId}` },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as MessageRow]);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void sb.removeChannel(ch);
    };
  }, [gameId]);

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = content.trim();
    if (!text || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/games/${code}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: text,
          ...(playerToken ? { player_token: playerToken } : {}),
          ...(!playerToken && hostToken ? { host_token: hostToken } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setContent("");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const canSend = !!(playerToken || hostToken);

  return (
    <aside className={`flex flex-col rounded-2xl border border-white/10 bg-white/5 ${className ?? ""}`}>
      <header className="px-4 py-2.5 border-b border-white/10 text-xs uppercase tracking-widest opacity-70">
        💬 Chat
      </header>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5 min-h-[160px] max-h-[40vh]">
        {messages.length === 0 ? (
          <p className="text-xs opacity-50 italic mt-2">No messages yet — say hi.</p>
        ) : (
          messages.map((m) => (
            <p key={m.id} className="text-sm leading-snug">
              <span className="font-bold opacity-80">{m.nickname ?? "?"}</span>
              <span className="opacity-90">: {m.content}</span>
            </p>
          ))
        )}
      </div>
      <form onSubmit={send} className="flex items-center gap-2 p-2 border-t border-white/10">
        <input
          value={content}
          onChange={(e) => setContent(e.target.value.slice(0, MESSAGE_MAX_LEN))}
          maxLength={MESSAGE_MAX_LEN}
          disabled={!canSend || busy}
          placeholder={canSend ? "Type a message…" : "Join the game to chat"}
          className="flex-1 rounded-lg bg-black/40 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-white/40 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!canSend || busy || content.trim().length === 0}
          className="rounded-lg bg-white text-black text-sm font-bold px-3 py-2 hover:bg-white/90"
        >
          Send
        </button>
      </form>
      {err && <p className="text-xs text-red-400 px-3 py-1.5">{err}</p>}
    </aside>
  );
}
