"use client";

import { useEffect, useState } from "react";
import { track } from "@/lib/track";
import { isKokoroLoaded, loadKokoro, type KokoroProgress } from "@/lib/tts-kokoro";

const STORAGE_KEY = "kokoro_enabled";

/**
 * Self-contained "🎙️ Better voices" toggle. Drops anywhere — manages its own
 * state, persists the user's choice, lazy-loads the Supertonic 2 model on first
 * enable, and shows progress while downloading. Consumers check
 * `isKokoroLoaded()` from `@/lib/tts-kokoro` (a module-level singleton) at
 * playback time to decide which TTS path to take.
 */
export function KokoroToggle({ onChange }: { onChange?: (loaded: boolean) => void }) {
  const [enabled, setEnabled] = useState(false);
  const [state, setState] = useState<"off" | "loading" | "ready" | "error">("off");
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);

  useEffect(() => {
    if (isKokoroLoaded()) {
      setEnabled(true);
      setState("ready");
      onChange?.(true);
      return;
    }
    if (localStorage.getItem(STORAGE_KEY) === "1") {
      setEnabled(true);
      void enable(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enable(askForConfirm: boolean) {
    if (askForConfirm) {
      const ok = window.confirm(
        "Better voices use a higher-quality offline model (Supertonic 2). First time only, this will download about 50 MB. After that it's cached forever and works offline. Continue?",
      );
      if (!ok) return;
    }
    setEnabled(true);
    setState("loading");
    setProgress(null);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch { /* ignore */ }
    try {
      await loadKokoro((p: KokoroProgress) => {
        if (p.status === "downloading" && p.loaded != null && p.total != null) {
          setProgress({ loaded: p.loaded, total: p.total });
        }
      });
      setState("ready");
      onChange?.(true);
      track("kokoro_enabled");
    } catch (e) {
      console.error("Kokoro load failed:", e);
      setState("error");
      onChange?.(false);
      track("kokoro_failed");
    }
  }

  function disable() {
    try { localStorage.setItem(STORAGE_KEY, "0"); } catch { /* ignore */ }
    setEnabled(false);
    setState("off");
    onChange?.(false);
  }

  const pct = progress && progress.total > 0 ? Math.round((progress.loaded / progress.total) * 100) : null;
  let label = "🎙️ Better voices: OFF";
  let title = "Use a higher-quality offline TTS model (Supertonic 2). First time downloads ~50 MB.";
  if (enabled && state === "loading") {
    label = pct != null ? `🎙️ Loading… ${pct}%` : "🎙️ Loading model…";
    title = "Downloading the voice model — first time only.";
  } else if (enabled && state === "ready") {
    label = "🎙️ Better voices: ON";
    title = "Using offline neural TTS. Click to switch back to browser voices.";
  } else if (enabled && state === "error") {
    label = "🎙️ Voice load failed";
    title = "Click to retry.";
  }

  return (
    <button
      onClick={enabled && state === "ready" ? disable : () => enable(true)}
      className={`text-xs uppercase tracking-wider rounded-full border px-3 py-1.5 transition ${
        enabled && state === "ready"
          ? "border-white bg-white text-black font-bold"
          : "border-white/20 hover:bg-white/10"
      }`}
      title={title}
    >
      {label}
    </button>
  );
}
