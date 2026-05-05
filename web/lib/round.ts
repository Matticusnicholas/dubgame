import { getAdminClient } from "./supabase-server";
import { ClipRow } from "./game-state";

/** Pick a random clip not already used in this game. Returns null if no clips at all. */
export async function pickNextClip(_gameId: string, alreadyPlayed: string[]): Promise<ClipRow | null> {
  const sb = getAdminClient();
  const query = sb.from("clips").select("*");
  const { data, error } = alreadyPlayed.length > 0
    ? await query.not("id", "in", `(${alreadyPlayed.map((id) => `"${id}"`).join(",")})`)
    : await query;
  if (error) throw error;

  let candidates = (data ?? []) as ClipRow[];
  if (candidates.length === 0) {
    // All clips used; fall back to the full pool so the game keeps going.
    const { data: all, error: e2 } = await sb.from("clips").select("*");
    if (e2) throw e2;
    candidates = (all ?? []) as ClipRow[];
  }
  if (candidates.length === 0) return null;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  return pick;
}
