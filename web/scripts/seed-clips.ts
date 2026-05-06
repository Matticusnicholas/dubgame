/**
 * Seed the `clips` table from a manifest.json produced by tools/clipprep.
 *
 * Usage:
 *   npm run seed:clips -- --manifest ../tools/clipprep/output/manifest.json
 *   (defaults to ../tools/clipprep/output/manifest.json if --manifest omitted)
 *
 *   Add `--local` to copy each clip mp4 into web/public/clips and store an
 *   absolute web path as file_path. Lets you run the game without uploading
 *   anything to Supabase Storage.
 */
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

loadDotenv({ path: ".env.local" });

interface SubtitleSeg {
  start_ms: number;
  end_ms: number;
  text: string;
}

interface ManifestClip {
  id: string;
  file: string;
  duration_ms: number;
  mute_start_ms: number;
  mute_end_ms: number;
  original_phrase?: string;
  context_before?: string;
  context_after?: string;
  subtitles?: SubtitleSeg[];
}

interface Manifest {
  source: string;
  clip_count: number;
  clips: ManifestClip[];
}

function parseArgs(argv: string[]): { manifest: string; local: boolean } {
  let manifest = resolve(process.cwd(), "../tools/clipprep/output/manifest.json");
  let local = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--manifest" && argv[i + 1]) {
      manifest = resolve(process.cwd(), argv[i + 1]);
      i++;
    } else if (argv[i] === "--local") {
      local = true;
    }
  }
  return { manifest, local };
}

async function main() {
  const { manifest: manifestPath, local } = parseArgs(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local");
    process.exit(1);
  }

  const raw = readFileSync(manifestPath, "utf-8");
  const manifest = JSON.parse(raw) as Manifest;
  console.log(`Loaded ${manifest.clip_count} clips from ${manifestPath}`);

  const manifestDir = dirname(manifestPath);
  let publicDir: string | null = null;
  if (local) {
    publicDir = resolve(process.cwd(), "public", "clips");
    mkdirSync(publicDir, { recursive: true });
  }

  const rows = manifest.clips.map((c) => {
    if (local && publicDir) {
      copyFileSync(resolve(manifestDir, c.file), resolve(publicDir, c.file));
      return {
        id: c.id,
        file_path: `/clips/${c.file}`,
        duration_ms: c.duration_ms,
        mute_start_ms: c.mute_start_ms,
        mute_end_ms: c.mute_end_ms,
        subtitles: c.subtitles ?? [],
      };
    }
    return {
      id: c.id,
      file_path: c.file,
      duration_ms: c.duration_ms,
      mute_start_ms: c.mute_start_ms,
      mute_end_ms: c.mute_end_ms,
      subtitles: c.subtitles ?? [],
    };
  });

  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await sb.from("clips").upsert(rows, { onConflict: "id" });
  if (error) {
    console.error("Upsert failed:", error);
    process.exit(1);
  }

  // Prune stale rows in *this pack only* (manifest is local mp4 = 'notld').
  // Without the package scope, a re-seed of the public-domain pack would also
  // wipe every YouTube-pack clip in the DB.
  const SEED_PACKAGE = "notld";
  const keepIds = new Set(rows.map((r) => r.id));
  const { data: existing } = await sb.from("clips").select("id").eq("package", SEED_PACKAGE);
  const stale = (existing ?? []).filter((r) => !keepIds.has(r.id)).map((r) => r.id);
  if (stale.length > 0) {
    // Find games referencing a stale clip via current_clip_id or played_clip_ids.
    const { data: allGames } = await sb.from("games").select("id, current_clip_id, played_clip_ids");
    const staleSet = new Set(stale);
    const gamesToDelete = (allGames ?? [])
      .filter((g: { id: string; current_clip_id: string | null; played_clip_ids: string[] | null }) => {
        if (g.current_clip_id && staleSet.has(g.current_clip_id)) return true;
        if (Array.isArray(g.played_clip_ids) && g.played_clip_ids.some((id) => staleSet.has(id))) return true;
        return false;
      })
      .map((g) => g.id);

    if (gamesToDelete.length > 0) {
      const { error: gameDelErr } = await sb.from("games").delete().in("id", gamesToDelete);
      if (gameDelErr) console.error("Failed to delete games referencing stale clips:", gameDelErr);
      else console.log(`Deleted ${gamesToDelete.length} games that referenced stale clips.`);
    }

    const { error: delErr } = await sb.from("clips").delete().in("id", stale);
    if (delErr) {
      console.error("Failed to prune stale clips:", delErr);
    } else {
      console.log(`Pruned ${stale.length} stale clip rows.`);
    }
  }

  console.log(`Upserted ${rows.length} clips into Supabase${local ? " (local mode — clips copied to web/public/clips/)" : ""}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
