"use client";

import { useEffect, useRef, useState } from "react";

const MAX_DURATION_MS = 7000; // matches the mute window upper bound
const TARGET_BITRATE = 24_000; // 24 kbps mono Opus = ~21 KB per 7s clip

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  // Prefer Opus in WebM (Chrome/Firefox/Edge), fall back to mp4 (iOS Safari).
  const tries = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
  ];
  for (const m of tries) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

export interface RecordedVoice {
  blob: Blob;
  durationMs: number;
  mimeType: string;
}

export function VoiceRecorder({
  value,
  onChange,
  disabled,
}: {
  value: RecordedVoice | null;
  onChange: (v: RecordedVoice | null) => void;
  disabled?: boolean;
}) {
  const [state, setState] = useState<"idle" | "requesting" | "recording" | "denied" | "unsupported">("idle");
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<number | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setState("unsupported");
    }
    return () => {
      cleanup();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  // If parent clears the recording (e.g. round changed), reset our preview URL.
  useEffect(() => {
    if (!value && previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }, [value]);

  function cleanup() {
    if (tickRef.current) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (stopTimerRef.current) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }

  async function startRecording() {
    if (state === "unsupported" || state === "recording") return;
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, {
        mimeType: mimeType || undefined,
        audioBitsPerSecond: TARGET_BITRATE,
      });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const durationMs = Math.min(MAX_DURATION_MS, Date.now() - startedAtRef.current);
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        // Generate a fresh preview URL.
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = URL.createObjectURL(blob);
        onChange({ blob, durationMs, mimeType: recorder.mimeType });
        cleanup();
        setState("idle");
        setElapsed(0);
      };

      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      recorder.start();
      setState("recording");
      setElapsed(0);
      tickRef.current = window.setInterval(() => {
        setElapsed(Date.now() - startedAtRef.current);
      }, 100);
      stopTimerRef.current = window.setTimeout(() => {
        try { recorder.state === "recording" && recorder.stop(); } catch { /* ignore */ }
      }, MAX_DURATION_MS);
    } catch {
      setState("denied");
    }
  }

  function stopRecording() {
    const r = recorderRef.current;
    if (r && r.state === "recording") r.stop();
  }

  function clearRecording() {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    onChange(null);
  }

  async function preview() {
    if (!value || !previewUrlRef.current) return;
    const audio = new Audio(previewUrlRef.current);
    setPlaying(true);
    try {
      await audio.play();
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
      });
    } finally {
      setPlaying(false);
    }
  }

  if (state === "unsupported") {
    return <p className="text-xs opacity-50">Voice recording isn't supported on this browser.</p>;
  }

  return (
    <div className="flex flex-col gap-2 p-3 rounded-xl bg-black/30 border border-white/10">
      <span className="text-xs uppercase tracking-wider opacity-60">Voice recording <span className="opacity-60 normal-case">(optional, max 7s)</span></span>
      {state === "recording" ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={stopRecording}
            className="rounded-full bg-red-600 hover:bg-red-500 px-4 py-2 text-sm font-bold flex items-center gap-2"
          >
            <span className="inline-block w-2 h-2 rounded-sm bg-white animate-pulse"></span>
            Stop
          </button>
          <span className="text-sm font-mono tabular-nums">
            {(elapsed / 1000).toFixed(1)}s / 7.0s
          </span>
          <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-red-500 transition-all"
              style={{ width: `${Math.min(100, (elapsed / MAX_DURATION_MS) * 100)}%` }}
            />
          </div>
        </div>
      ) : value ? (
        <div className="flex items-center gap-2">
          <button type="button" onClick={preview} disabled={playing} className="rounded-full bg-white/15 hover:bg-white/25 px-3 py-1.5 text-sm">
            {playing ? "▶︎ Playing…" : "▶︎ Preview"}
          </button>
          <span className="text-xs opacity-70">
            {(value.durationMs / 1000).toFixed(1)}s · {(value.blob.size / 1024).toFixed(0)} KB
          </span>
          <button type="button" onClick={clearRecording} disabled={disabled} className="ml-auto rounded-full bg-white/10 hover:bg-white/20 px-3 py-1.5 text-xs">
            ✕ Clear
          </button>
          <button type="button" onClick={startRecording} disabled={disabled} className="rounded-full bg-white/15 hover:bg-white/25 px-3 py-1.5 text-xs">
            Re-record
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={startRecording}
            disabled={disabled || state === "requesting"}
            className="rounded-full bg-white text-black px-4 py-2 text-sm font-bold"
          >
            🎤 {state === "requesting" ? "Granting mic…" : "Record voice"}
          </button>
          {state === "denied" && <span className="text-xs text-red-400">Mic permission denied.</span>}
        </div>
      )}
    </div>
  );
}
