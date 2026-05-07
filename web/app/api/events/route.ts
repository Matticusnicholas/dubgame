import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "node:crypto";
import { getAdminClient } from "@/lib/supabase-server";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const Body = z.object({
  event_name: z.string().min(1).max(64),
  props: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  path: z.string().max(256).optional(),
  referrer: z.string().max(256).optional(),
  session_id: z.string().min(1).max(64).optional(),
});

const SALT = process.env.IP_HASH_SALT || "dubgame-default-salt-change-me";

export async function POST(req: NextRequest) {
  const ip = getClientIp(req.headers);
  // Generous rate limit (avoid blocking real bursts) but stops abuse.
  if (!rateLimit(`events:${ip}`, 120, 60_000)) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "bad event" }, { status: 400 });
  }

  const ipHash = createHash("sha256").update(SALT + ip).digest("hex").slice(0, 16);
  const ua = req.headers.get("user-agent")?.slice(0, 256) ?? null;

  const sb = getAdminClient();
  const { error } = await sb.from("events").insert({
    event_name: body.event_name,
    props: body.props,
    path: body.path ?? null,
    referrer: body.referrer ?? null,
    session_id: body.session_id ?? null,
    ip_hash: ipHash,
    user_agent: ua,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
