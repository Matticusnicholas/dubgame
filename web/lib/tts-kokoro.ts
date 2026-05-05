"use client";

// Opt-in higher-quality TTS using Kokoro-82M ONNX, lazy-loaded so the model
// (~82 MB) is only downloaded when a host explicitly enables it.
//
// Once loaded, the model is cached by the browser indefinitely. No service
// signup required — model files come from Hugging Face's public CDN.

type KokoroInstance = {
  generate: (text: string, opts: { voice: string }) => Promise<{ toBlob: () => Blob }>;
};

let kokoroInstance: KokoroInstance | null = null;
let loadingPromise: Promise<KokoroInstance> | null = null;

const KOKORO_MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

export interface KokoroProgress {
  status: "downloading" | "loading" | "ready";
  loaded?: number;
  total?: number;
  file?: string;
}

export type KokoroProgressFn = (p: KokoroProgress) => void;

export async function loadKokoro(onProgress?: KokoroProgressFn): Promise<KokoroInstance> {
  if (kokoroInstance) return kokoroInstance;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    onProgress?.({ status: "loading" });
    const { KokoroTTS } = await import("kokoro-js");
    const tts = await KokoroTTS.from_pretrained(KOKORO_MODEL_ID, {
      dtype: "q8",
      device: "wasm",
      progress_callback: (data: { status?: string; loaded?: number; total?: number; file?: string }) => {
        if (data?.status === "progress") {
          onProgress?.({
            status: "downloading",
            loaded: data.loaded,
            total: data.total,
            file: data.file,
          });
        }
      },
    } as Parameters<typeof KokoroTTS.from_pretrained>[1]);
    kokoroInstance = tts as unknown as KokoroInstance;
    onProgress?.({ status: "ready" });
    return kokoroInstance;
  })();

  return loadingPromise;
}

export function isKokoroLoaded(): boolean {
  return kokoroInstance !== null;
}

// Map our existing voice variants to Kokoro voice IDs + a playbackRate adjustment
// (Web Audio playback rate couples pitch and speed — fine for our chipmunk/demon
// gimmicks, since each Kokoro voice already has its own baseline character).
const VARIANT_TO_KOKORO: Record<string, { voice: string; rate?: number }> = {
  default:     { voice: "af_heart" },
  robot:       { voice: "am_onyx",   rate: 0.95 },
  demon:       { voice: "am_fenrir", rate: 0.75 },
  chipmunk:    { voice: "af_alloy",  rate: 1.5 },
  old_man:     { voice: "am_santa",  rate: 0.8 },
  news_anchor: { voice: "am_michael", rate: 1.05 },
  cursed_siri: { voice: "bf_alice",  rate: 1.4 },
};

export function pickKokoroVoiceForVariant(variantId: string | null | undefined): { voice: string; rate: number } {
  let id = variantId ?? "default";
  if (id === "random") {
    const pool = Object.keys(VARIANT_TO_KOKORO).filter((k) => k !== "default");
    id = pool[Math.floor(Math.random() * pool.length)] ?? "default";
  }
  const cfg = VARIANT_TO_KOKORO[id] ?? VARIANT_TO_KOKORO.default;
  return { voice: cfg.voice, rate: cfg.rate ?? 1.0 };
}

/** Generate Kokoro audio for a phrase. Throws if Kokoro isn't loaded. */
export async function generateKokoroBlob(text: string, voice: string): Promise<Blob> {
  if (!kokoroInstance) throw new Error("Kokoro not loaded — call loadKokoro() first");
  const audio = await kokoroInstance.generate(text, { voice });
  return audio.toBlob();
}

/** Play a pre-generated audio blob with a given playback rate. Resolves on end. */
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
