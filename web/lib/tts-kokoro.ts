"use client";

// Premium browser TTS — currently powered by Supertonic 2 via transformers.js
// (ONNX). The file/function names still say "Kokoro" so existing callers don't
// break; we just point the implementation at a faster on-device model.
//
// Supertonic 2 specs: 66M params, ~167× realtime, runs entirely in the browser
// via WebGPU (CPU/WASM fallback). One-time download is smaller than Kokoro and
// inference latency is roughly half.
//
// We keep voice "variants" as our existing identifiers (robot, demon, chipmunk,
// etc.) and realize them via playback-rate manipulation since Supertonic 2's
// public ONNX export ships a single voice. If/when multi-voice variants land
// upstream we can map variant -> speaker-id directly.

const MODEL_ID = "onnx-community/Supertonic-TTS-2-ONNX";

// Supertonic 2 ships 10 speaker embeddings (.bin files) — 5 female F1-F5,
// 5 male M1-M5. We load each on first use and cache forever.
const VOICE_BIN_URL = (id: string) =>
  `https://huggingface.co/${MODEL_ID}/resolve/main/voices/${id}.bin`;

const SUPERTONIC_VOICES = ["F1", "F2", "F3", "F4", "F5", "M1", "M2", "M3", "M4", "M5"] as const;
const FALLBACK_VOICE = "F1";

const embeddingCache = new Map<string, Float32Array>();

async function loadVoiceEmbedding(voiceId: string): Promise<Float32Array> {
  const id = (SUPERTONIC_VOICES as readonly string[]).includes(voiceId) ? voiceId : FALLBACK_VOICE;
  const cached = embeddingCache.get(id);
  if (cached) return cached;
  const buf = await (await fetch(VOICE_BIN_URL(id))).arrayBuffer();
  const arr = new Float32Array(buf);
  embeddingCache.set(id, arr);
  return arr;
}

type Pipeline = (text: string, opts?: Record<string, unknown>) => Promise<{
  audio: Float32Array;
  sampling_rate: number;
}>;

let ttsInstance: Pipeline | null = null;
let loadingPromise: Promise<Pipeline> | null = null;

export interface KokoroProgress {
  status: "downloading" | "loading" | "ready";
  loaded?: number;
  total?: number;
  file?: string;
}

export type KokoroProgressFn = (p: KokoroProgress) => void;

export async function loadKokoro(onProgress?: KokoroProgressFn): Promise<Pipeline> {
  if (ttsInstance) return ttsInstance;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    onProgress?.({ status: "loading" });
    const { pipeline, env } = await import("@huggingface/transformers");
    // Allow remote model download from the public HF Hub mirror — no auth needed.
    env.allowLocalModels = false;
    env.useBrowserCache = true;

    // Try WebGPU first (much faster); fall back to WASM if unavailable.
    let device: "webgpu" | "wasm" = "wasm";
    try {
      if (typeof navigator !== "undefined" && (navigator as { gpu?: unknown }).gpu) {
        device = "webgpu";
      }
    } catch { /* keep wasm */ }

    const tts = await pipeline("text-to-speech", MODEL_ID, {
      device,
      dtype: "fp32",
      progress_callback: (data: unknown) => {
        const d = data as { status?: string; loaded?: number; total?: number; file?: string };
        if (d?.status === "progress") {
          onProgress?.({
            status: "downloading",
            loaded: d.loaded,
            total: d.total,
            file: d.file,
          });
        }
      },
    });
    ttsInstance = tts as unknown as Pipeline;
    onProgress?.({ status: "ready" });
    return ttsInstance;
  })();

  return loadingPromise;
}

export function isKokoroLoaded(): boolean {
  return ttsInstance !== null;
}

// Variant ID is now a Supertonic voice ID (F1..F5, M1..M5). We resolve any
// legacy IDs (from before the catalog swap) to a sensible default.
const LEGACY_VARIANT_TO_VOICE: Record<string, string> = {
  default:     "F1",
  robot:       "M5",
  demon:       "M3",
  chipmunk:    "F3",
  old_man:     "M5",
  news_anchor: "M2",
  cursed_siri: "F5",
};

export function pickKokoroVoiceForVariant(variantId: string | null | undefined): { voice: string; rate: number } {
  const raw = variantId ?? "F1";
  if (raw === "random") {
    const pick = SUPERTONIC_VOICES[Math.floor(Math.random() * SUPERTONIC_VOICES.length)];
    return { voice: pick, rate: 1.0 };
  }
  // Direct hit on a Supertonic voice id
  if ((SUPERTONIC_VOICES as readonly string[]).includes(raw)) {
    return { voice: raw, rate: 1.0 };
  }
  // Map legacy variant ids (robot/demon/chipmunk/etc.) to Supertonic equivalents.
  const mapped = LEGACY_VARIANT_TO_VOICE[raw] ?? FALLBACK_VOICE;
  return { voice: mapped, rate: 1.0 };
}

// ---------- audio helpers ----------

function float32ToWavBlob(samples: Float32Array, sampleRate: number): Blob {
  // 16-bit PCM mono WAV
  const numChannels = 1;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  // fmt chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);                   // PCM chunk size
  view.setUint16(20, 1, true);                    // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 8 * bytesPerSample, true);   // bits per sample
  // data chunk
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  // PCM samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

// ---------- public synthesis API ----------

export async function generateKokoroBlob(text: string, voice: string): Promise<Blob> {
  const tts = await loadKokoro();
  const embedding = await loadVoiceEmbedding(voice);
  const out = await tts(text, { speaker_embeddings: embedding });
  return float32ToWavBlob(out.audio, out.sampling_rate);
}

export async function playKokoroBlob(blob: Blob, rate: number): Promise<void> {
  const url = URL.createObjectURL(blob);
  const audioEl = new Audio(url);
  audioEl.playbackRate = rate;
  try {
    await audioEl.play();
    await new Promise<void>((resolve) => {
      const cleanup = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      audioEl.onended = cleanup;
      audioEl.onerror = cleanup;
    });
  } catch {
    URL.revokeObjectURL(url);
  }
}

export async function speakWithKokoro(text: string, opts: { voice: string; rate: number }): Promise<void> {
  const blob = await generateKokoroBlob(text, opts.voice);
  await playKokoroBlob(blob, opts.rate);
}
