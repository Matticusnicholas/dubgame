import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isValidCode } from "@/lib/code";
import { getAdminClient } from "@/lib/supabase-server";
import { badRequest, conflict, getGameByCode, notFound } from "@/lib/api-helpers";
import { MESSAGE_MAX_LEN } from "@/lib/game-state";

export const runtime = "nodejs";

const Body = z.object({
  player_token: z.string().optional(),
  host_token: z.string().optional(),
  content: z.string().trim().min(1).max(MESSAGE_MAX_LEN),
});

const RATE_LIMIT_MS = 1000; // 1 message per second per player

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
    return badRequest(`Message 1-${MESSAGE_MAX_LEN} chars; player_token or host_token required`);
  }

  const game = await getGameByCode(code);
  if (!game) return notFound("Game not found");

  const sb = getAdminClient();

  // Identify the sender. Host can send under their nickname player row.
  let playerId: string | null = null;
  let nickname: string | null = "Host";
  if (body.host_token) {
    if (game.host_token !== body.host_token) return badRequest("Bad host_token");
    // Hosts have a corresponding player row (we auto-create one at create time).
    const { data: hostPlayer } = await sb
      .from("players")
      .select("id, nickname, last_msg_at")
      .eq("game_id", game.id)
      .order("joined_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (hostPlayer) {
      playerId = hostPlayer.id;
      nickname = hostPlayer.nickname;
      if (hostPlayer.last_msg_at && Date.now() - new Date(hostPlayer.last_msg_at).getTime() < RATE_LIMIT_MS) {
        return conflict("Slow down — one message per second");
      }
    }
  } else if (body.player_token) {
    const { data: player } = await sb
      .from("players")
      .select("id, nickname, last_msg_at")
      .eq("game_id", game.id)
      .eq("player_token", body.player_token)
      .maybeSingle();
    if (!player) return badRequest("Bad player_token");
    playerId = player.id;
    nickname = player.nickname;
    if (player.last_msg_at && Date.now() - new Date(player.last_msg_at).getTime() < RATE_LIMIT_MS) {
      return conflict("Slow down — one message per second");
    }
  } else {
    return badRequest("player_token or host_token required");
  }

  // Soft profanity scrub: hard slurs only. Real moderation belongs in a v2.
  const content = scrubBlatantSlurs(body.content);

  const { error: insertErr } = await sb.from("messages").insert({
    game_id: game.id,
    player_id: playerId,
    nickname,
    content,
  });
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  if (playerId) {
    await sb.from("players").update({ last_msg_at: new Date().toISOString() }).eq("id", playerId);
  }

  return NextResponse.json({ ok: true });
}

function scrubBlatantSlurs(s: string): string {
  // Tiny baseline filter for the worst offenders. Real moderation goes elsewhere.
  const blocked = ["nigger", "kike", "faggot", "retard"];
  let out = s;
  for (const w of blocked) {
    out = out.replace(new RegExp(`\\b${w}s?\\b`, "gi"), "*".repeat(w.length));
  }
  return out;
}
