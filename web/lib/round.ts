import { getAdminClient } from "./supabase-server";
import { ClipRow } from "./game-state";

const inList = (ids: string[]) => `(${ids.map((id) => `"${id}"`).join(",")})`;

/**
 * Pick a random clip with two levels of exclusion, falling back as needed:
 *   1. Try clips not in (alreadyPlayed ∪ extraExclude) — best case, fully fresh
 *   2. Fall back to clips not in alreadyPlayed (the host's seen list is exhausted)
 *   3. Fall back to the full pool (this game itself exhausted the pool — rollover)
 */
export async function pickNextClip(
  _gameId: string,
  alreadyPlayed: string[],
  extraExclude: string[] = [],
  pack: string = "notld",
): Promise<ClipRow | null> {
  const sb = getAdminClient();
  const fullExclude = Array.from(new Set([...alreadyPlayed, ...extraExclude]));

  const tryExclude = async (excluded: string[]): Promise<ClipRow[]> => {
    const q = sb.from("clips").select("*").eq("package", pack);
    const { data, error } = excluded.length > 0
      ? await q.not("id", "in", inList(excluded))
      : await q;
    if (error) throw error;
    return (data ?? []) as ClipRow[];
  };

  // Tier 1: fully fresh within pack
  let candidates = await tryExclude(fullExclude);

  // Tier 2: relax to in-game-only dedup, still within pack
  if (candidates.length === 0 && alreadyPlayed.length > 0) {
    candidates = await tryExclude(alreadyPlayed);
  }

  // Tier 3: full pool of this pack (rollover)
  if (candidates.length === 0) {
    candidates = await tryExclude([]);
  }

  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
}
