import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isValidCode } from "@/lib/code";
import { getAdminClient } from "@/lib/supabase-server";
import { badRequest, conflict, requirePlayer } from "@/lib/api-helpers";

export const runtime = "nodejs";

const Body = z.object({
  player_token: z.string(),
  submission_id: z.string().uuid(),
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
    return badRequest("submission_id required");
  }

  const { game, player, error } = await requirePlayer(code, body.player_token);
  if (error || !game || !player) return error!;
  if (game.state !== "voting") return conflict("Not in voting phase");

  const sb = getAdminClient();

  // The submission must belong to this game + round, and not be the voter's own.
  const { data: submission } = await sb
    .from("submissions")
    .select("id, player_id")
    .eq("id", body.submission_id)
    .eq("game_id", game.id)
    .eq("round", game.current_round)
    .maybeSingle();
  if (!submission) return badRequest("Submission not in current round");
  if (submission.player_id === player.id) return badRequest("Cannot vote for your own dub");

  const { error: voteErr } = await sb.from("votes").upsert(
    {
      game_id: game.id,
      round: game.current_round,
      voter_id: player.id,
      voted_for_submission_id: submission.id,
    },
    { onConflict: "game_id,round,voter_id" },
  );
  if (voteErr) return NextResponse.json({ error: voteErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
