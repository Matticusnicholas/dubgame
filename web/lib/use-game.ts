"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getBrowserClient } from "./supabase-browser";
import type { ClipRow, GameRow, PlayerRow, SubmissionRow, VoteRow } from "./game-state";

export interface GameSnapshot {
  game: GameRow | null;
  players: PlayerRow[];
  submissions: SubmissionRow[];
  votes: VoteRow[];
  clip: ClipRow | null;
  loading: boolean;
  error: string | null;
}

export function useGame(code: string): GameSnapshot & { refresh: () => Promise<void> } {
  const [game, setGame] = useState<GameRow | null>(null);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([]);
  const [votes, setVotes] = useState<VoteRow[]>([]);
  const [clip, setClip] = useState<ClipRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const gameIdRef = useRef<string | null>(null);
  const clipIdRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const sb = getBrowserClient();
    setError(null);
    const { data: g, error: gErr } = await sb
      .from("games")
      .select("*")
      .eq("code", code)
      .maybeSingle();
    if (gErr) {
      setError(gErr.message);
      setLoading(false);
      return;
    }
    if (!g) {
      setError("Game not found");
      setLoading(false);
      return;
    }
    setGame(g as GameRow);
    gameIdRef.current = g.id;

    const [{ data: pls }, { data: subs }, { data: vs }] = await Promise.all([
      sb.from("players").select("*").eq("game_id", g.id),
      sb.from("submissions").select("*").eq("game_id", g.id),
      sb.from("votes").select("*").eq("game_id", g.id),
    ]);
    setPlayers((pls ?? []) as PlayerRow[]);
    setSubmissions((subs ?? []) as SubmissionRow[]);
    setVotes((vs ?? []) as VoteRow[]);

    if (g.current_clip_id && g.current_clip_id !== clipIdRef.current) {
      clipIdRef.current = g.current_clip_id;
      const { data: c } = await sb.from("clips").select("*").eq("id", g.current_clip_id).maybeSingle();
      setClip((c ?? null) as ClipRow | null);
    } else if (!g.current_clip_id) {
      clipIdRef.current = null;
      setClip(null);
    }
    setLoading(false);
  }, [code]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Subscribe to realtime changes on the game and its child tables.
  useEffect(() => {
    if (!game) return;
    const sb = getBrowserClient();
    const gameId = game.id;
    const channel = sb
      .channel(`game-${gameId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "games", filter: `id=eq.${gameId}` }, async (payload) => {
        const next = payload.new as GameRow;
        setGame((prev) => ({ ...(prev ?? next), ...next }));
        if (next.current_clip_id && next.current_clip_id !== clipIdRef.current) {
          clipIdRef.current = next.current_clip_id;
          const { data: c } = await sb.from("clips").select("*").eq("id", next.current_clip_id).maybeSingle();
          setClip((c ?? null) as ClipRow | null);
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `game_id=eq.${gameId}` }, () => {
        void sb.from("players").select("*").eq("game_id", gameId).then(({ data }) => {
          setPlayers((data ?? []) as PlayerRow[]);
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "submissions", filter: `game_id=eq.${gameId}` }, () => {
        void sb.from("submissions").select("*").eq("game_id", gameId).then(({ data }) => {
          setSubmissions((data ?? []) as SubmissionRow[]);
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "votes", filter: `game_id=eq.${gameId}` }, () => {
        void sb.from("votes").select("*").eq("game_id", gameId).then(({ data }) => {
          setVotes((data ?? []) as VoteRow[]);
        });
      })
      .subscribe();

    return () => {
      void sb.removeChannel(channel);
    };
    // We only want to (re)subscribe when the game id changes — not when the row object updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.id]);

  return { game, players, submissions, votes, clip, loading, error, refresh };
}
