import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateGameCode, generateToken } from "@/lib/code";
import { getAdminClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

const Body = z.object({
  total_rounds: z.number().int().min(1).max(20).default(10),
  nickname: z.string().trim().min(1).max(20),
});

export async function POST(req: NextRequest) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json().catch(() => ({})));
  } catch {
    return NextResponse.json({ error: "nickname required (1-20 chars)" }, { status: 400 });
  }

  const sb = getAdminClient();
  const hostToken = generateToken();

  // Generate a unique 5-letter code; retry on collision.
  let game: { id: string; code: string } | null = null;
  for (let attempt = 0; attempt < 8 && !game; attempt++) {
    const code = generateGameCode();
    const { data, error } = await sb
      .from("games")
      .insert({
        code,
        host_token: hostToken,
        state: "lobby",
        current_round: 0,
        total_rounds: body.total_rounds,
      })
      .select("id, code")
      .single();
    if (error) {
      // unique violation: try again with a different code
      if ((error as { code?: string }).code === "23505") continue;
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    game = data;
  }
  if (!game) {
    return NextResponse.json({ error: "Could not generate unique code" }, { status: 500 });
  }

  // Auto-add the host as a player so they can play along on the host machine.
  const playerToken = generateToken();
  const { data: player, error: playerErr } = await sb
    .from("players")
    .insert({
      game_id: game.id,
      player_token: playerToken,
      nickname: body.nickname,
    })
    .select("id, nickname")
    .single();
  if (playerErr) {
    return NextResponse.json({ error: playerErr.message }, { status: 500 });
  }

  return NextResponse.json({
    code: game.code,
    host_token: hostToken,
    player_id: player.id,
    player_token: playerToken,
    nickname: player.nickname,
  });
}
