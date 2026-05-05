"use client";

import { useEffect, useRef, useState } from "react";

const SKIP_STORAGE_KEY = "skip_intro";
const INTRO_SRC = "/intro.mp4";

export function IntroOverlay({ onDone }: { onDone: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [skipNextTime, setSkipNextTime] = useState(false);
  const [muted, setMuted] = useState(true);
  const [videoMissing, setVideoMissing] = useState(false);

  useEffect(() => {
    // Try autoplay (muted is the only reliable form on the web).
    const v = videoRef.current;
    if (!v) return;
    v.muted = true;
    v.play().catch(() => {
      /* user-gesture required, fine to ignore */
    });
  }, []);

  function dismiss() {
    if (skipNextTime) {
      try {
        localStorage.setItem(SKIP_STORAGE_KEY, "1");
      } catch { /* ignore quota/privacy errors */ }
    }
    onDone();
  }

  function toggleMute() {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black rounded-2xl overflow-hidden">
      {videoMissing ? (
        <div className="text-center p-8 max-w-lg">
          <p className="text-2xl font-bold mb-3">Welcome to Stupid Dubbing</p>
          <p className="opacity-70 mb-6">
            Watch the clip. The dialogue cuts out — make it up. The funniest dub wins the round.
          </p>
          <button
            onClick={dismiss}
            className="rounded-xl bg-white text-black font-bold py-3 px-6"
          >
            Let's go
          </button>
        </div>
      ) : (
        <>
          <video
            ref={videoRef}
            src={INTRO_SRC}
            playsInline
            autoPlay
            onEnded={dismiss}
            onError={() => setVideoMissing(true)}
            className="w-full h-full object-contain"
          />
          <div className="absolute top-3 right-3 flex gap-2">
            <button
              onClick={toggleMute}
              className="rounded-full bg-black/60 hover:bg-black/80 px-3 py-1.5 text-sm"
              title="Toggle audio"
            >
              {muted ? "🔇 Unmute" : "🔊 Mute"}
            </button>
            <button
              onClick={dismiss}
              className="rounded-full bg-black/60 hover:bg-black/80 px-3 py-1.5 text-sm font-bold"
            >
              Skip intro →
            </button>
          </div>
          <label className="absolute bottom-3 right-3 flex items-center gap-2 bg-black/60 hover:bg-black/80 rounded-full px-3 py-1.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={skipNextTime}
              onChange={(e) => setSkipNextTime(e.target.checked)}
              className="accent-white"
            />
            Don't show this again
          </label>
        </>
      )}
    </div>
  );
}

export function shouldShowIntro(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(SKIP_STORAGE_KEY) !== "1";
  } catch {
    return true;
  }
}
