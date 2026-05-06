import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isValidCode } from "@/lib/code";
import { getAdminClient } from "@/lib/supabase-server";
import { badRequest, conflict, requirePlayer } from "@/lib/api-helpers";
import { PHRASE_MAX_LEN } from "@/lib/game-state";

export const runtime = "nodejs";

const VOICE_BUCKET = "voices";
const MAX_VOICE_BYTES = 200 * 1024; // 200 KB cap (~7s of 24 kbps Opus + slack)

const Body = z.object({
  player_token: z.string(),
  // phrase can be empty when a voice recording is supplied — the recording
  // becomes the entire submission. Required-or-recording logic enforced below.
  phrase: z.string().trim().max(PHRASE_MAX_LEN).default(""),
  voice: z.string().min(1).max(32).default("random"),
});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;
  if (!isValidCode(code)) return badRequest("Invalid game code");

  // Accept either application/json (text-only) or multipart/form-data (text + voice blob).
  const contentType = req.headers.get("content-type") ?? "";
  let parsed: z.infer<typeof Body>;
  let voiceFile: File | null = null;

  if (contentType.includes("multipart/form-data")) {
    const fd = await req.formData();
    const raw = {
      player_token: String(fd.get("player_token") ?? ""),
      phrase: String(fd.get("phrase") ?? ""),
      voice: String(fd.get("voice") ?? "random") || "random",
    };
    const result = Body.safeParse(raw);
    if (!result.success) return badRequest("invalid submission");
    parsed = result.data;
    const v = fd.get("voice_file");
    if (v instanceof File && v.size > 0) {
      if (v.size > MAX_VOICE_BYTES) return badRequest(`voice file too large (>${Math.round(MAX_VOICE_BYTES / 1024)} KB)`);
      voiceFile = v;
    }
  } else {
    try {
      parsed = Body.parse(await req.json());
    } catch {
      return badRequest("invalid submission");
    }
  }

  // Need at least one of phrase or recording.
  if (!parsed.phrase && !voiceFile) {
    return badRequest("Type a dub or record a voice (or both)");
  }

  const { game, player, error } = await requirePlayer(code, parsed.player_token);
  if (error || !game || !player) return error!;
  if (game.state !== "submitting") return conflict("Not accepting submissions right now");

  const sb = getAdminClient();

  // If a voice file was uploaded, push it to the `voices` bucket. Object name
  // includes the round so re-submits in a later round don't clobber prior audio.
  let voiceUrl: string | null = null;
  if (voiceFile) {
    const ext = voiceFile.type.includes("mp4") ? "mp4" : "webm";
    const path = `${game.id}/r${game.current_round}_${player.id}.${ext}`;
    const arrayBuf = await voiceFile.arrayBuffer();
    const { error: uploadErr } = await sb.storage
      .from(VOICE_BUCKET)
      .upload(path, arrayBuf, { contentType: voiceFile.type, upsert: true });
    if (uploadErr) {
      return NextResponse.json({ error: `voice upload failed: ${uploadErr.message}` }, { status: 500 });
    }
    // Use a short-lived signed URL instead of a public URL so the bucket can
    // stay private. 24h is well past any realistic game session — and game-
    // end cleanup deletes the underlying file regardless.
    const { data: signed, error: signErr } = await sb.storage
      .from(VOICE_BUCKET)
      .createSignedUrl(path, 60 * 60 * 24);
    if (signErr || !signed?.signedUrl) {
      return NextResponse.json({ error: `voice signing failed: ${signErr?.message ?? "no url"}` }, { status: 500 });
    }
    voiceUrl = signed.signedUrl;
  }

  const { error: insertErr } = await sb.from("submissions").upsert(
    {
      game_id: game.id,
      round: game.current_round,
      player_id: player.id,
      phrase: parsed.phrase,
      voice: parsed.voice,
      ...(voiceUrl !== null ? { voice_url: voiceUrl } : {}),
    },
    { onConflict: "game_id,round,player_id" },
  );
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
