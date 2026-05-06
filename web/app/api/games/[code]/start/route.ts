import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isValidCode } from "@/lib/code";
import { getAdminClient } from "@/lib/supabase-server";
import { badRequest, conflict, requireHost } from "@/lib/api-helpers";
import { pickNextClip } from "@/lib/round";

export const runtime = "nodejs";

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
  if (game.state !== "lobby") return conflict("Game already started");

  const sb = getAdminClient();
  const { count: playerCount } = await sb
    .from("players")
    .select("id", { count: "exact", head: true })
    .eq("game_id", game.id);
  if (!playerCount || playerCount < 1) return conflict("Need at least one player");

  const clip = await pickNextClip(
    game.id,
    game.played_clip_ids ?? [],
    body.exclude_clip_ids ?? [],
    game.package ?? "notld",
  );
  if (!clip) return conflict("No clips available in this pack — seed the clips table first");

  const { error: updateErr } = await sb
    .from("games")
    .update({
      state: "submitting",
      current_round: 1,
      current_clip_id: clip.id,
      played_clip_ids: [...(game.played_clip_ids ?? []), clip.id],
    })
    .eq("id", game.id);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, current_round: 1, current_clip_id: clip.id });
}
