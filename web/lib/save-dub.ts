"use client";

// Client-side mp4 dubbing via ffmpeg.wasm.
//
// Combines a public-domain source mp4 with a dub audio Blob (recorded voice or
// Kokoro-generated WAV) and produces a downloadable mp4 with the original
// audio muted between [muteStart, muteEnd] and the dub mixed in over the gap.
//
// All processing is in the user's browser. Zero bandwidth on our servers
// beyond the one-time playback fetch (which is cached anyway).
//
// First call lazily loads ffmpeg.wasm (~30 MB) and caches it; subsequent
// saves are fast.

import type { FFmpeg } from "@ffmpeg/ffmpeg";

let ffmpegInstance: FFmpeg | null = null;
let loadingPromise: Promise<FFmpeg> | null = null;

export type LoadProgress = (msg: string) => void;

async function loadFFmpeg(onProgress?: LoadProgress): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    onProgress?.("Loading dub engine (one-time, ~30 MB)…");
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const { toBlobURL } = await import("@ffmpeg/util");
    const ff = new FFmpeg();
    // Single-threaded core so we don't need COOP/COEP headers on Vercel.
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";
    await ff.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
    });
    ffmpegInstance = ff;
    return ff;
  })();
  return loadingPromise;
}

export interface SaveDubInput {
  /** URL or absolute path to the source mp4 (must be CORS-accessible). */
  sourceUrl: string;
  /** The dub audio: recorded voice or Kokoro-generated audio. */
  dubAudioBlob: Blob;
  muteStartMs: number;
  muteEndMs: number;
  onProgress?: LoadProgress;
}

export async function buildDubbedClip(input: SaveDubInput): Promise<Blob> {
  const { sourceUrl, dubAudioBlob, muteStartMs, muteEndMs, onProgress } = input;
  const ff = await loadFFmpeg(onProgress);

  onProgress?.("Reading clip…");
  const sourceBytes = new Uint8Array(await (await fetch(sourceUrl)).arrayBuffer());
  await ff.writeFile("input.mp4", sourceBytes);

  onProgress?.("Reading your dub…");
  const dubBytes = new Uint8Array(await dubAudioBlob.arrayBuffer());
  // Source format hint via extension; ffmpeg sniffs anyway.
  const dubExt = dubAudioBlob.type.includes("mp4") ? "mp4"
    : dubAudioBlob.type.includes("webm") ? "webm"
    : dubAudioBlob.type.includes("wav") ? "wav"
    : "audio";
  const dubName = `dub.${dubExt}`;
  await ff.writeFile(dubName, dubBytes);

  onProgress?.("Mixing audio…");
  const muteStartS = (muteStartMs / 1000).toFixed(3);
  const muteEndS = (muteEndMs / 1000).toFixed(3);
  await ff.exec([
    "-i", "input.mp4",
    "-i", dubName,
    "-filter_complex",
    [
      // Silence the original audio inside the muted span
      `[0:a]volume=enable='between(t,${muteStartS},${muteEndS})':volume=0[a0]`,
      // Delay the dub so it starts at mute_start_ms
      `[1:a]adelay=${muteStartMs}|${muteStartMs},apad[a1]`,
      // Mix
      `[a0][a1]amix=inputs=2:duration=first:dropout_transition=0[aout]`,
    ].join(";"),
    "-map", "0:v",
    "-map", "[aout]",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "160k",
    "-movflags", "+faststart",
    "-y",
    "output.mp4",
  ]);

  onProgress?.("Finalizing…");
  const out = await ff.readFile("output.mp4");
  // out is Uint8Array; wrap as Blob with the type browsers will save sensibly.
  const data = (out instanceof Uint8Array ? out : new Uint8Array(out as unknown as ArrayBuffer)).slice().buffer;
  return new Blob([data], { type: "video/mp4" });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
