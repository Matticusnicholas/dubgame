import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateGameCode, generateToken, isValidCode } from "@/lib/code";
import { getAdminClient } from "@/lib/supabase-server";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const Body = z.object({
  total_rounds: z.number().int().min(1).max(20).default(10),
  nickname: z.string().trim().min(1).max(20),
  custom_code: z.string().trim().toUpperCase().length(5).optional().or(z.literal("")),
  package: z.string().min(1).max(40).default("notld"),
  is_public: z.boolean().default(false),
  lobby_title: z.string().trim().max(60).optional(),
});

export async function POST(req: NextRequest) {
  // Throttle game creation: 10 games / minute / IP.
  const ip = getClientIp(req.headers);
  if (!rateLimit(`create-game:${ip}`, 10, 60_000)) {
    return NextResponse.json({ error: "Slow down — too many games created from this IP" }, { status: 429 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json().catch(() => ({})));
  } catch {
    return NextResponse.json({ error: "nickname required (1-20 chars)" }, { status: 400 });
  }

  const sb = getAdminClient();
  const hostToken = generateToken();

  // If the host requested a specific code, try it once and 409 on collision.
  // Otherwise generate a random one with retry on collision.
  let game: { id: string; code: string } | null = null;
  const wantedCode = body.custom_code && body.custom_code.length === 5 ? body.custom_code : null;

  if (wantedCode) {
    if (!isValidCode(wantedCode)) {
      return NextResponse.json(
        { error: "Custom code must be 5 chars, A–Z and 2–9 only (I, L, O, 0, 1 not allowed)" },
        { status: 400 },
      );
    }
    const { data, error } = await sb
      .from("games")
      .insert({
        code: wantedCode,
        host_token: hostToken,
        state: "lobby",
        current_round: 0,
        total_rounds: body.total_rounds,
        package: body.package,
        is_public: body.is_public,
        lobby_title: body.lobby_title?.trim() || null,
      })
      .select("id, code")
      .single();
    if (error) {
      if ((error as { code?: string }).code === "23505") {
        return NextResponse.json({ error: `Code ${wantedCode} is already in use — try another` }, { status: 409 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    game = data;
  } else {
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
          package: body.package,
        })
        .select("id, code")
        .single();
      if (error) {
        if ((error as { code?: string }).code === "23505") continue;
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      game = data;
    }
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
