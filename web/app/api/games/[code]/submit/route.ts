import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isValidCode } from "@/lib/code";
import { getAdminClient } from "@/lib/supabase-server";
import { badRequest, conflict, requirePlayer } from "@/lib/api-helpers";
import { PHRASE_MAX_LEN } from "@/lib/game-state";

export const runtime = "nodejs";

const Body = z.object({
  player_token: z.string(),
  phrase: z.string().trim().min(1).max(PHRASE_MAX_LEN),
  voice: z.string().min(1).max(32).default("random"),
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
  } catch {
    return badRequest(`phrase required (1-${PHRASE_MAX_LEN} chars)`);
  }

  const { game, player, error } = await requirePlayer(code, body.player_token);
  if (error || !game || !player) return error!;
  if (game.state !== "submitting") return conflict("Not accepting submissions right now");

  const sb = getAdminClient();
  const { error: insertErr } = await sb.from("submissions").upsert(
    {
      game_id: game.id,
      round: game.current_round,
      player_id: player.id,
      phrase: body.phrase,
      voice: body.voice,
    },
    { onConflict: "game_id,round,player_id" },
  );
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
