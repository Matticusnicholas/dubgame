"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

declare global {
  interface Window {
    YT?: {
      Player: new (el: HTMLElement | string, opts: Record<string, unknown>) => YTPlayerInstance;
      PlayerState: { ENDED: number; PLAYING: number; PAUSED: number; BUFFERING: number; CUED: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface YTPlayerInstance {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  mute: () => void;
  unMute: () => void;
  getCurrentTime: () => number;
  destroy: () => void;
}

let apiLoadPromise: Promise<void> | null = null;
function loadYouTubeApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();
  if (apiLoadPromise) return apiLoadPromise;
  apiLoadPromise = new Promise<void>((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    }
  });
  return apiLoadPromise;
}

export interface SubtitleSegment {
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface YouTubeClipPlayerProps {
  videoId: string;
  muteStartMs: number;
  muteEndMs: number;
  onMuteEnter?: () => void;
  onMuteExit?: () => void;
  playToken?: number | string | null;
  onEnded?: () => void;
  muteOverlay?: React.ReactNode;
  subtitles?: SubtitleSegment[];
  hideSubtitles?: boolean;
  className?: string;
}

export interface YouTubeClipPlayerHandle {
  pause: () => void;
  play: () => void;
  seekTo: (seconds: number) => void;
  getCurrentTimeMs: () => number;
}

/**
 * Plays a YouTube Short via the IFrame Player API. Mirrors the orchestration of
 * the local-mp4 ClipPlayer: programmatic mute/unmute around the muted window,
 * onMuteEnter/onMuteExit callbacks for parent-controlled pause/resume, subtitle
 * rendering at the bottom (suppressed during the muted span).
 *
 * Embedding is sanctioned by YouTube — creators get the views, no copyright risk.
 */
export const YouTubeClipPlayer = forwardRef<YouTubeClipPlayerHandle, YouTubeClipPlayerProps>(
  function YouTubeClipPlayer(
    { videoId, muteStartMs, muteEndMs, onMuteEnter, onMuteExit, playToken, onEnded, muteOverlay, subtitles, hideSubtitles, className },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const playerRef = useRef<YTPlayerInstance | null>(null);
    const [inMute, setInMute] = useState(false);
    const [activeSubtitle, setActiveSubtitle] = useState<string>("");
    const wasInMuteRef = useRef(false);
    const subtitlesRef = useRef<SubtitleSegment[] | undefined>(subtitles);
    subtitlesRef.current = subtitles;
    const handlersRef = useRef({ onMuteEnter, onMuteExit, onEnded });
    handlersRef.current = { onMuteEnter, onMuteExit, onEnded };

    useImperativeHandle(ref, () => ({
      pause: () => playerRef.current?.pauseVideo(),
      play: () => playerRef.current?.playVideo(),
      seekTo: (s) => playerRef.current?.seekTo(s, true),
      getCurrentTimeMs: () => (playerRef.current?.getCurrentTime() ?? 0) * 1000,
    }), []);

    // Mount the YT player once per videoId.
    useEffect(() => {
      let mounted = true;
      loadYouTubeApi().then(() => {
        if (!mounted || !containerRef.current || !window.YT) return;
        playerRef.current?.destroy();
        playerRef.current = new window.YT.Player(containerRef.current, {
          videoId,
          host: "https://www.youtube-nocookie.com",
          playerVars: {
            autoplay: 0,
            controls: 0,
            modestbranding: 1,
            rel: 0,
            iv_load_policy: 3,
            playsinline: 1,
            fs: 0,
            disablekb: 1,
          },
          events: {
            onReady: (e: { target: YTPlayerInstance }) => {
              playerRef.current = e.target;
            },
            onStateChange: (e: { data: number }) => {
              if (window.YT && e.data === window.YT.PlayerState.ENDED) {
                handlersRef.current.onEnded?.();
              }
            },
          },
        });
      });
      return () => {
        mounted = false;
        playerRef.current?.destroy();
        playerRef.current = null;
      };
    }, [videoId]);

    // Restart from t=0 whenever playToken changes to a new non-null value.
    useEffect(() => {
      if (playToken == null) return;
      const tryStart = () => {
        const p = playerRef.current;
        if (!p) {
          window.setTimeout(tryStart, 100);
          return;
        }
        wasInMuteRef.current = false;
        setInMute(false);
        try {
          p.unMute();
          p.seekTo(0, true);
          p.playVideo();
        } catch {
          /* ignore */
        }
      };
      tryStart();
    }, [playToken]);

    // Polling loop: mute around the window, fire callbacks on transitions, sync subtitles.
    useEffect(() => {
      let raf = 0;
      let alive = true;
      const tick = () => {
        if (!alive) return;
        const p = playerRef.current;
        if (p) {
          const ms = (p.getCurrentTime?.() ?? 0) * 1000;
          const should = ms >= muteStartMs && ms < muteEndMs;
          try {
            if (should) p.mute(); else p.unMute();
          } catch { /* ignore until ready */ }
          if (should !== wasInMuteRef.current) {
            wasInMuteRef.current = should;
            setInMute(should);
            if (should) handlersRef.current.onMuteEnter?.();
            else handlersRef.current.onMuteExit?.();
          }
          const subs = subtitlesRef.current;
          if (subs && subs.length > 0 && !should) {
            const seg = subs.find((s) => ms >= s.start_ms && ms <= s.end_ms);
            const next = seg?.text ?? "";
            setActiveSubtitle((prev) => (prev !== next ? next : prev));
          } else {
            setActiveSubtitle((prev) => (prev !== "" ? "" : prev));
          }
        }
        raf = window.requestAnimationFrame(tick);
      };
      raf = window.requestAnimationFrame(tick);
      return () => {
        alive = false;
        window.cancelAnimationFrame(raf);
      };
    }, [muteStartMs, muteEndMs]);

    return (
      <div className={(className ?? "w-full h-full") + " relative"}>
        <div ref={containerRef} className="w-full h-full bg-black rounded-2xl overflow-hidden" />
        {inMute && muteOverlay != null && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {muteOverlay}
          </div>
        )}
        {!hideSubtitles && activeSubtitle && (
          <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 max-w-[92%]">
            <p
              className="px-5 py-2.5 rounded-xl bg-black/85 text-center text-2xl md:text-3xl font-bold leading-snug tracking-tight shadow-2xl"
              style={{ textShadow: "0 2px 6px rgba(0,0,0,0.9)" }}
            >
              {activeSubtitle}
            </p>
          </div>
        )}
      </div>
    );
  },
);
