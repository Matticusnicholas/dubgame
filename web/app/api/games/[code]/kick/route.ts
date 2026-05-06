import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isValidCode } from "@/lib/code";
import { getAdminClient } from "@/lib/supabase-server";
import { badRequest, requireHost } from "@/lib/api-helpers";

export const runtime = "nodejs";

const Body = z.object({
  host_token: z.string(),
  player_id: z.string().uuid(),
});

/**
 * Host-only: remove a player from the game. Cascades their submissions and votes
 * via the FK constraints. The kicked player's browser sees their player row vanish
 * via Realtime and shows them an exit screen.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;
  if (!isValidCode(code)) return badRequest("Invalid game code");

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return badRequest("host_token + player_id required");
  }

  const { game, error } = await requireHost(code, body.host_token);
  if (error || !game) return error!;

  // Don't let the host kick themselves (would orphan the game).
  const sb = getAdminClient();
  const { data: target } = await sb
    .from("players")
    .select("id, joined_at")
    .eq("id", body.player_id)
    .eq("game_id", game.id)
    .maybeSingle();
  if (!target) return badRequest("player not in this game");

  // The very first player in a game IS the host's player row — protect it.
  const { data: first } = await sb
    .from("players")
    .select("id")
    .eq("game_id", game.id)
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (first && first.id === body.player_id) {
    return badRequest("can't kick the host");
  }

  const { error: delErr } = await sb.from("players").delete().eq("id", body.player_id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
