import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns currently-joinable public games (lobby state) for the home-page browser.
 * Includes player count via a join. Limit 30 to keep payloads small.
 */
export async function GET() {
  const sb = getAdminClient();

  const { data: games, error } = await sb
    .from("games")
    .select("id, code, package, lobby_title, total_rounds, created_at")
    .eq("is_public", true)
    .eq("state", "lobby")
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (!games || games.length === 0) {
    return NextResponse.json({ lobbies: [] });
  }

  const ids = games.map((g) => g.id);
  const { data: counts } = await sb
    .from("players")
    .select("game_id")
    .in("game_id", ids);

  const countByGame = new Map<string, number>();
  for (const p of counts ?? []) {
    countByGame.set(p.game_id, (countByGame.get(p.game_id) ?? 0) + 1);
  }

  const lobbies = games.map((g) => ({
    code: g.code,
    package: g.package,
    title: g.lobby_title,
    total_rounds: g.total_rounds,
    created_at: g.created_at,
    player_count: countByGame.get(g.id) ?? 0,
  }));

  return NextResponse.json({ lobbies });
}
