"use client";

// Voice variants the player can pick when submitting a dub. Each one is a tweak
// to the default browser voice's rate + pitch — the underlying voice stays the
// same, but the result sounds wildly different. Pitch range is 0-2, rate 0.1-10.

export interface VoiceVariant {
  id: string;
  label: string;
  emoji: string;
  rate: number;
  pitch: number;
}

export const VOICES: VoiceVariant[] = [
  { id: "default",     label: "Default",     emoji: "🗣️", rate: 1.0, pitch: 1.0 },
  { id: "robot",       label: "Robot",       emoji: "🤖", rate: 0.95, pitch: 0.5 },
  { id: "demon",       label: "Demon",       emoji: "😈", rate: 0.7, pitch: 0.0 },
  { id: "chipmunk",    label: "Chipmunk",    emoji: "🐿️", rate: 1.5, pitch: 2.0 },
  { id: "old_man",     label: "Old Man",     emoji: "👴", rate: 0.7, pitch: 0.6 },
  { id: "news_anchor", label: "News Anchor", emoji: "📰", rate: 1.15, pitch: 1.0 },
  { id: "cursed_siri", label: "Cursed Siri", emoji: "📵", rate: 1.7, pitch: 1.7 },
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
