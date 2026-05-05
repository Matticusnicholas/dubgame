"use client";

import { useEffect, useRef, useState } from "react";

export interface ClipPlayerProps {
  src: string;
  muteStartMs: number;
  muteEndMs: number;
  /** When `pauseOnMute` is true, the video pauses at mute_start and waits for `onMuteEnter`. */
  pauseOnMute?: boolean;
  /** Fires once when playback enters the mute window. */
  onMuteEnter?: () => void;
  /** When this prop transitions from a falsy/null to a non-null token, the video is played from t=0. */
  playToken?: number | string | null;
  /** Called when the underlying video element fires `ended`. */
  onEnded?: () => void;
  /** Render-prop overlay rendered on top of the video while inside the mute window. */
  muteOverlay?: React.ReactNode;
  className?: string;
}

/**
 * Plays a clip with playback-time muting. Sets `volume = 0` between mute_start and mute_end.
 *
 * Uses a tight rAF/setInterval polling loop (~30fps) instead of the `timeupdate` event,
 * because `timeupdate` only fires every ~250ms which is wider than some of our mute windows
 * and lets audio leak around the edges.
 */
export function ClipPlayer({
  src,
  muteStartMs,
  muteEndMs,
  pauseOnMute,
  onMuteEnter,
  playToken,
  onEnded,
  muteOverlay,
  className,
}: ClipPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hasPausedThisPlayRef = useRef(false);
  const [inMute, setInMute] = useState(false);

  // Restart playback from t=0 whenever playToken transitions to a new non-null value.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || playToken == null) return;
    hasPausedThisPlayRef.current = false;
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

  // Tight polling loop — fires while playing, samples currentTime, applies mute/pause.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let raf = 0;
    let alive = true;

    const tick = () => {
      if (!alive) return;
      const ms = video.currentTime * 1000;
      const should = ms >= muteStartMs && ms < muteEndMs;
      // Use both volume AND muted — some browsers ignore volume changes during playback.
      video.volume = should ? 0 : 1;
      video.muted = should;
      setInMute((prev) => (prev !== should ? should : prev));
      if (pauseOnMute && should && !hasPausedThisPlayRef.current && !video.paused) {
        hasPausedThisPlayRef.current = true;
        video.pause();
        onMuteEnter?.();
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => {
      alive = false;
      window.cancelAnimationFrame(raf);
    };
  }, [muteStartMs, muteEndMs, pauseOnMute, onMuteEnter]);

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
    </div>
  );
}

/** Imperatively skip to the end of the mute window and resume playback on a ClipPlayer's video. */
export function jumpPastMute(video: HTMLVideoElement | null, muteEndMs: number) {
  if (!video) return;
  video.currentTime = Math.max(video.currentTime, muteEndMs / 1000 + 0.01);
  void video.play();
}
