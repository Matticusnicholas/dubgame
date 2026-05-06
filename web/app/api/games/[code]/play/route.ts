import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { isValidCode } from "@/lib/code";
import { getAdminClient } from "@/lib/supabase-server";
import { badRequest, requireHost } from "@/lib/api-helpers";

export const runtime = "nodejs";

const Body = z.object({ host_token: z.string() });

/**
 * Broadcasts a "play the current clip from t=0 on every connected client" signal
 * by updating games.play_token. Realtime subscribers see the row update and
 * trigger their local ClipPlayer to start.
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

  const sb = getAdminClient();
  const token = randomBytes(8).toString("hex");
  const { error: updateErr } = await sb.from("games").update({ play_token: token }).eq("id", game.id);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
  return NextResponse.json({ ok: true, play_token: token });
}
