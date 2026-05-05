"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export interface SubtitleSegment {
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface ClipPlayerProps {
  src: string;
  muteStartMs: number;
  muteEndMs: number;
  /** Fires once when playback crosses into the mute window. */
  onMuteEnter?: () => void;
  /** Fires once when playback crosses out of the mute window. */
  onMuteExit?: () => void;
  /** When this prop transitions from a falsy/null to a non-null token, the video is played from t=0. */
  playToken?: number | string | null;
  /** Called when the underlying video element fires `ended`. */
  onEnded?: () => void;
  /** Render-prop overlay rendered on top of the video while inside the mute window. */
  muteOverlay?: React.ReactNode;
  /** Per-clip subtitle segments (relative timestamps). Rendered as a captioning bar at the bottom. */
  subtitles?: SubtitleSegment[];
  /** Hide the captioning bar entirely (e.g. during reveal where the dub overlay takes its place). */
  hideSubtitles?: boolean;
  className?: string;
}

/**
 * Plays a clip with playback-time muting. Sets `muted = true` between mute_start and mute_end.
 *
 * Uses a tight rAF polling loop (~60fps) instead of the `timeupdate` event, which only fires
 * every ~250ms and is too coarse for short mute windows.
 *
 * The component does NOT pause itself — the parent owns pause/play decisions and uses the
 * forwarded video ref + onMuteEnter/onMuteExit callbacks to orchestrate (e.g., during reveal,
 * pause at mute_end only if TTS is still speaking).
 */
export const ClipPlayer = forwardRef<HTMLVideoElement, ClipPlayerProps>(function ClipPlayer(
  { src, muteStartMs, muteEndMs, onMuteEnter, onMuteExit, playToken, onEnded, muteOverlay, subtitles, hideSubtitles, className },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useImperativeHandle(ref, () => videoRef.current!, []);
  const [inMute, setInMute] = useState(false);
  const [activeSubtitle, setActiveSubtitle] = useState<string>("");
  const wasInMuteRef = useRef(false);

  // Restart playback from t=0 whenever playToken transitions to a new non-null value.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || playToken == null) return;
    wasInMuteRef.current = false;
    setInMute(false);
    try {
      video.currentTime = 0;
      video.muted = false;
      video.volume = 1;
      void video.play();
    } catch {
      /* autoplay restrictions */
    }
  }, [playToken]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let raf = 0;
    let alive = true;

    const tick = () => {
      if (!alive) return;
      const ms = video.currentTime * 1000;
      const should = ms >= muteStartMs && ms < muteEndMs;
      video.volume = should ? 0 : 1;
      video.muted = should;
      if (should !== wasInMuteRef.current) {
        wasInMuteRef.current = should;
        setInMute(should);
        if (should) onMuteEnter?.();
        else onMuteExit?.();
      }
      // Sync subtitle to playback time. Suppress entirely during the mute span
      // so the answer is never accidentally shown at the bottom.
      if (subtitles && subtitles.length > 0 && !should) {
        const seg = subtitles.find((s) => ms >= s.start_ms && ms <= s.end_ms);
        const next = seg?.text ?? "";
        setActiveSubtitle((prev) => (prev !== next ? next : prev));
      } else {
        setActiveSubtitle((prev) => (prev !== "" ? "" : prev));
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => {
      alive = false;
      window.cancelAnimationFrame(raf);
    };
  }, [muteStartMs, muteEndMs, onMuteEnter, onMuteExit]);

  return (
    <div className={(className ?? "w-full h-full") + " relative"}>
      <video
        ref={videoRef}
        src={src}
        preload="auto"
        playsInline
        onEnded={onEnded}
        className="w-full h-full object-contain bg-black rounded-2xl"
      />
      {inMute && muteOverlay != null && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          {muteOverlay}
        </div>
      )}
      {!hideSubtitles && activeSubtitle && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 max-w-[92%]">
          <p className="px-5 py-2.5 rounded-xl bg-black/85 text-center text-2xl md:text-3xl font-bold leading-snug tracking-tight shadow-2xl"
             style={{ textShadow: "0 2px 6px rgba(0,0,0,0.9)" }}>
            {activeSubtitle}
          </p>
        </div>
      )}
    </div>
  );
});
