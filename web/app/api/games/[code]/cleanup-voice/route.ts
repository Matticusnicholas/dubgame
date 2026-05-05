import { NextRequest, NextResponse } from "next/server";
import { isValidCode } from "@/lib/code";
import { getAdminClient } from "@/lib/supabase-server";
import { badRequest, requireHost } from "@/lib/api-helpers";

export const runtime = "nodejs";

const VOICE_BUCKET = "voices";

/**
 * Called via navigator.sendBeacon when the host's tab closes/navigates away.
 * Wipes any uploaded voice recordings for this game so they don't accumulate
 * in Storage when the host abandons mid-session.
 *
 * Auth: host_token must match the game's host_token. Body can be FormData
 * (sendBeacon's typical wire format) or JSON (manual fetch).
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;
  if (!isValidCode(code)) return badRequest("Invalid game code");

  const contentType = req.headers.get("content-type") ?? "";
  let hostToken = "";
  if (contentType.includes("multipart/form-data") || contentType.includes("application/x-www-form-urlencoded")) {
    const fd = await req.formData();
    hostToken = String(fd.get("host_token") ?? "");
  } else {
    try {
      const body = await req.json();
      hostToken = String(body?.host_token ?? "");
    } catch {
      return badRequest("host_token required");
    }
  }
  if (!hostToken) return badRequest("host_token required");

  const { game, error } = await requireHost(code, hostToken);
  if (error || !game) return error!;

  const sb = getAdminClient();
  const { data, error: listErr } = await sb.storage.from(VOICE_BUCKET).list(game.id);
  if (listErr || !data || data.length === 0) {
    return new NextResponse(null, { status: 204 });
  }
  const paths = data.map((f) => `${game.id}/${f.name}`);
  await sb.storage.from(VOICE_BUCKET).remove(paths);
  return new NextResponse(null, { status: 204 });
}
