import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { SupabaseClient } from "@supabase/supabase-js";
import { isValidCode } from "@/lib/code";
import { getAdminClient } from "@/lib/supabase-server";
import { badRequest, conflict, requireHost } from "@/lib/api-helpers";
import { pickNextClip } from "@/lib/round";

export const runtime = "nodejs";

const VOICE_BUCKET = "voices";

async function deleteGameVoiceFiles(sb: SupabaseClient, gameId: string): Promise<void> {
  // List everything under the game's folder, then bulk delete.
  const { data, error } = await sb.storage.from(VOICE_BUCKET).list(gameId);
  if (error || !data || data.length === 0) return;
  const paths = data.map((f) => `${gameId}/${f.name}`);
  await sb.storage.from(VOICE_BUCKET).remove(paths);
}

const Body = z.object({
  host_token: z.string(),
  exclude_clip_ids: z.array(z.string()).max(500).optional(),
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
    return badRequest("host_token required");
  }

  const { game, error } = await requireHost(code, body.host_token);
  if (error || !game) return error!;

  const sb = getAdminClient();

  switch (game.state) {
    case "submitting": {
      // submitting → reveal
      const { error: e } = await sb.from("games").update({ state: "reveal" }).eq("id", game.id);
      if (e) return NextResponse.json({ error: e.message }, { status: 500 });
      return NextResponse.json({ ok: true, state: "reveal" });
    }

    case "reveal": {
      // reveal → voting
      const { error: e } = await sb.from("games").update({ state: "voting" }).eq("id", game.id);
      if (e) return NextResponse.json({ error: e.message }, { status: 500 });
      return NextResponse.json({ ok: true, state: "voting" });
    }

    case "voting": {
      // voting → scoreboard. Tally votes for this round, increment scores.
      const { data: votes, error: ve } = await sb
        .from("votes")
        .select("voted_for_submission_id")
        .eq("game_id", game.id)
        .eq("round", game.current_round);
      if (ve) return NextResponse.json({ error: ve.message }, { status: 500 });

      const tally = new Map<string, number>();
      for (const v of votes ?? []) {
        tally.set(v.voted_for_submission_id, (tally.get(v.voted_for_submission_id) ?? 0) + 1);
      }

      // Map each submission to its player and add points.
      if (tally.size > 0) {
        const submissionIds = Array.from(tally.keys());
        const { data: subs } = await sb
          .from("submissions")
          .select("id, player_id")
          .in("id", submissionIds);
        const playerPoints = new Map<string, number>();
        for (const s of subs ?? []) {
          const pts = tally.get(s.id) ?? 0;
          playerPoints.set(s.player_id, (playerPoints.get(s.player_id) ?? 0) + pts);
        }
        // Apply points: read current score and increment. Sequential per-player; small N.
        for (const [playerId, pts] of playerPoints.entries()) {
          if (pts === 0) continue;
          const { data: pl } = await sb
            .from("players")
            .select("score")
            .eq("id", playerId)
            .single();
          await sb
            .from("players")
            .update({ score: (pl?.score ?? 0) + pts })
            .eq("id", playerId);
        }
      }

      const { error: e } = await sb
        .from("games")
        .update({ state: "scoreboard" })
        .eq("id", game.id);
      if (e) return NextResponse.json({ error: e.message }, { status: 500 });
      return NextResponse.json({ ok: true, state: "scoreboard" });
    }

    case "scoreboard": {
      // scoreboard → submitting (next round) OR finished
      if (game.current_round >= game.total_rounds) {
        const { error: e } = await sb.from("games").update({ state: "finished" }).eq("id", game.id);
        if (e) return NextResponse.json({ error: e.message }, { status: 500 });
        return NextResponse.json({ ok: true, state: "finished" });
      }
      const clip = await pickNextClip(game.id, game.played_clip_ids ?? [], body.exclude_clip_ids ?? []);
      if (!clip) return conflict("No clips available");
      const { error: e } = await sb
        .from("games")
        .update({
          state: "submitting",
          current_round: game.current_round + 1,
          current_clip_id: clip.id,
          played_clip_ids: [...(game.played_clip_ids ?? []), clip.id],
        })
        .eq("id", game.id);
      if (e) return NextResponse.json({ error: e.message }, { status: 500 });
      return NextResponse.json({
        ok: true,
        state: "submitting",
        current_round: game.current_round + 1,
        current_clip_id: clip.id,
      });
    }

    case "finished": {
      // finished → lobby (play again, reset round count + scores). Also wipe
      // any uploaded voice recordings in Storage so we don't accumulate.
      const { error: e1 } = await sb
        .from("games")
        .update({ state: "lobby", current_round: 0, current_clip_id: null, played_clip_ids: [] })
        .eq("id", game.id);
      if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
      await sb.from("submissions").delete().eq("game_id", game.id);
      await sb.from("votes").delete().eq("game_id", game.id);
      await sb.from("players").update({ score: 0 }).eq("game_id", game.id);
      await deleteGameVoiceFiles(sb, game.id);
      return NextResponse.json({ ok: true, state: "lobby" });
    }

    default:
      return conflict(`Cannot advance from state '${game.state}'`);
  }
}
