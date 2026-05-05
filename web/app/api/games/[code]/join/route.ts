import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateToken, isValidCode } from "@/lib/code";
import { getAdminClient } from "@/lib/supabase-server";
import { badRequest, conflict, getGameByCode, notFound } from "@/lib/api-helpers";

export const runtime = "nodejs";

const Body = z.object({
  nickname: z.string().trim().min(1).max(20),
});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;
  if (!isValidCode(code)) return badRequest("Invalid game code");

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return badRequest("Invalid body — nickname is required (1-20 chars)");
  }

  const game = await getGameByCode(code);
  if (!game) return notFound("Game not found");
  if (game.state !== "lobby") return conflict("Game has already started");

  const sb = getAdminClient();
  // Disallow duplicate nicknames per game so the scoreboard isn't confusing.
  const { data: existing } = await sb
    .from("players")
    .select("id")
    .eq("game_id", game.id)
    .ilike("nickname", body.nickname)
    .maybeSingle();
  if (existing) return conflict("Nickname already taken in this game");

  const playerToken = generateToken();
  const { data: player, error } = await sb
    .from("players")
    .insert({
      game_id: game.id,
      player_token: playerToken,
      nickname: body.nickname,
    })
    .select("id, nickname")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    player_id: player.id,
    player_token: playerToken,
    nickname: player.nickname,
    game_id: game.id,
  });
}
