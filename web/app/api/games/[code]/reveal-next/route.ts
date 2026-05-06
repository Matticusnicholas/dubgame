import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { isValidCode } from "@/lib/code";
import { getAdminClient } from "@/lib/supabase-server";
import { badRequest, conflict, requireHost } from "@/lib/api-helpers";

export const runtime = "nodejs";

const Body = z.object({
  host_token: z.string(),
  // null/undefined => "play current submission again from t=0"
  // string         => "switch to this submission and play it"
  submission_id: z.string().uuid().nullable().optional(),
});

/**
 * Synchronizes the reveal phase across every connected client. Updates which
 * submission is currently being revealed AND issues a fresh play_token so all
 * browsers restart their video at the same moment and TTS in unison.
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
    return badRequest("host_token required");
  }

  const { game, error } = await requireHost(code, body.host_token);
  if (error || !game) return error!;
  if (game.state !== "reveal") return conflict("Not in reveal phase");

  const sb = getAdminClient();
  const update: Record<string, unknown> = {
    play_token: randomBytes(8).toString("hex"),
  };
  if (body.submission_id !== undefined) {
    if (body.submission_id !== null) {
      // Validate the submission belongs to this game/round.
      const { data: sub } = await sb
        .from("submissions")
        .select("id")
        .eq("id", body.submission_id)
        .eq("game_id", game.id)
        .eq("round", game.current_round)
        .maybeSingle();
      if (!sub) return badRequest("submission not in current round");
    }
    update.current_reveal_submission_id = body.submission_id;
  }
  const { error: updErr } = await sb.from("games").update(update).eq("id", game.id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
