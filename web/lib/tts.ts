"use client";

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
