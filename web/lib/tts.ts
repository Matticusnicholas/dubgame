"use client";

// Voice variants the player can pick when submitting a dub. Each one is a tweak
// to the default browser voice's rate + pitch — the underlying voice stays the
// same, but the result sounds wildly different. Pitch range is 0-2, rate 0.1-10.

export interface VoiceVariant {
  id: string;
  label: string;
  emoji: string;
  /** Web Speech API rate when premium TTS is off. Premium ignores this — voices have their own character. */
  rate: number;
  /** Web Speech API pitch when premium TTS is off. Premium ignores this. */
  pitch: number;
}

// Catalog matches Supertonic 2's pre-built speaker embeddings. When premium
// TTS is on, each id loads the corresponding `.bin` from HF and synthesizes
// with that voice. When off, browser Web Speech uses a default voice and
// applies the rate/pitch tweaks below as a degraded gimmick fallback.
export const VOICES: VoiceVariant[] = [
  { id: "F1", label: "F1", emoji: "👩", rate: 1.0,  pitch: 1.0 },
  { id: "F2", label: "F2", emoji: "👩", rate: 1.0,  pitch: 1.1 },
  { id: "F3", label: "F3", emoji: "👩", rate: 1.05, pitch: 1.4 },
  { id: "F4", label: "F4", emoji: "👩", rate: 0.95, pitch: 0.9 },
  { id: "F5", label: "F5", emoji: "👩", rate: 1.1,  pitch: 1.5 },
  { id: "M1", label: "M1", emoji: "👨", rate: 1.0,  pitch: 1.0 },
  { id: "M2", label: "M2", emoji: "👨", rate: 1.0,  pitch: 0.9 },
  { id: "M3", label: "M3", emoji: "👨", rate: 0.95, pitch: 0.5 },
  { id: "M4", label: "M4", emoji: "👨", rate: 1.05, pitch: 0.7 },
  { id: "M5", label: "M5", emoji: "👨", rate: 0.9,  pitch: 0.3 },
];

export const VOICE_RANDOM_ID = "random";

export function getVoiceById(id: string): VoiceVariant {
  return VOICES.find((v) => v.id === id) ?? VOICES[0];
}

export function pickRandomVoice(): VoiceVariant {
  // Skip "default" so random always sounds at least a little weird.
  const pool = VOICES.filter((v) => v.id !== "default");
  return pool[Math.floor(Math.random() * pool.length)];
}

export function resolveVoice(id: string | null | undefined): VoiceVariant {
  if (!id || id === VOICE_RANDOM_ID) return pickRandomVoice();
  return getVoiceById(id);
}

// Web Speech API wrapper. Handles the Chrome quirk where getVoices() returns
// an empty list on the very first call until the `voiceschanged` event fires.

let voicesReady: Promise<SpeechSynthesisVoice[]> | null = null;

export function getVoices(): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return Promise.resolve([]);
  }
  if (voicesReady) return voicesReady;

  voicesReady = new Promise((resolve) => {
    const existing = window.speechSynthesis.getVoices();
    if (existing.length > 0) {
      resolve(existing);
      return;
    }
    const handler = () => {
      window.speechSynthesis.removeEventListener("voiceschanged", handler);
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener("voiceschanged", handler);
    // Safety timeout
    setTimeout(() => {
      const v = window.speechSynthesis.getVoices();
      if (v.length > 0) resolve(v);
    }, 1000);
  });
  return voicesReady;
}

export interface SpeakOptions {
  rate?: number;   // 0.1 - 10, default 1
  pitch?: number;  // 0 - 2, default 1
  volume?: number; // 0 - 1, default 1
  voice?: SpeechSynthesisVoice | null;
  lang?: string;
}

export async function speak(text: string, opts: SpeakOptions = {}): Promise<void> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return;
  }
  await getVoices();

  return new Promise<void>((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    if (opts.voice) u.voice = opts.voice;
    if (opts.lang) u.lang = opts.lang;
    u.rate = opts.rate ?? 1;
    u.pitch = opts.pitch ?? 1;
    u.volume = opts.volume ?? 1;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}

export function cancelSpeech() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

// Pick a default English voice when one is available; first-loaded otherwise.
export async function defaultVoice(): Promise<SpeechSynthesisVoice | null> {
  const voices = await getVoices();
  if (voices.length === 0) return null;
  const preferEn = voices.find((v) => /^en/i.test(v.lang));
  return preferEn ?? voices[0];
}
