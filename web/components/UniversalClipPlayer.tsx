"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import { ClipPlayer } from "./ClipPlayer";
import { YouTubeClipPlayer } from "./YouTubeClipPlayer";
import type { ClipRow } from "@/lib/game-state";

export interface UniversalClipPlayerHandle {
  pause: () => void;
  play: () => void;
  seekToSeconds: (s: number) => void;
  getCurrentTimeMs: () => number;
  isPaused: () => boolean;
}

export interface UniversalClipPlayerProps {
  clip: ClipRow;
  src: string;                         // resolved URL for the local-mp4 path
  onMuteEnter?: () => void;
  onMuteExit?: () => void;
  playToken?: number | null;
  onEnded?: () => void;
  muteOverlay?: React.ReactNode;
  hideSubtitles?: boolean;
}

/**
 * Switches between local-mp4 ClipPlayer and YouTube IFrame embed based on
 * whether the clip has a `youtube_id`. Exposes a unified imperative handle
 * so callers don't have to care which kind of clip is playing.
 */
export const UniversalClipPlayer = forwardRef<UniversalClipPlayerHandle, UniversalClipPlayerProps>(
  function UniversalClipPlayer(props, ref) {
    const videoElRef = useRef<HTMLVideoElement>(null);
    const ytRef = useRef<{
      pause: () => void;
      play: () => void;
      seekTo: (s: number) => void;
      getCurrentTimeMs: () => number;
    }>(null);
    const isYT = !!props.clip.youtube_id;

    useImperativeHandle(
      ref,
      (): UniversalClipPlayerHandle => ({
        pause: () => {
          if (isYT) ytRef.current?.pause();
          else videoElRef.current?.pause();
        },
        play: () => {
          if (isYT) ytRef.current?.play();
          else { void videoElRef.current?.play(); }
        },
        seekToSeconds: (s) => {
          if (isYT) ytRef.current?.seekTo(s);
          else if (videoElRef.current) videoElRef.current.currentTime = s;
        },
        getCurrentTimeMs: () => {
          if (isYT) return ytRef.current?.getCurrentTimeMs() ?? 0;
          return (videoElRef.current?.currentTime ?? 0) * 1000;
        },
        isPaused: () => {
          if (isYT) return false; // YT: we track via parent state instead
          return videoElRef.current?.paused ?? true;
        },
      }),
      [isYT],
    );

    if (isYT && props.clip.youtube_id) {
      return (
        <YouTubeClipPlayer
          ref={ytRef}
          videoId={props.clip.youtube_id}
          muteStartMs={props.clip.mute_start_ms}
          muteEndMs={props.clip.mute_end_ms}
          subtitles={props.clip.subtitles}
          hideSubtitles={props.hideSubtitles}
          muteOverlay={props.muteOverlay}
          playToken={props.playToken}
          onMuteEnter={props.onMuteEnter}
          onMuteExit={props.onMuteExit}
          onEnded={props.onEnded}
        />
      );
    }

    return (
      <ClipPlayer
        ref={videoElRef}
        src={props.src}
        muteStartMs={props.clip.mute_start_ms}
        muteEndMs={props.clip.mute_end_ms}
        subtitles={props.clip.subtitles}
        hideSubtitles={props.hideSubtitles}
        muteOverlay={props.muteOverlay}
        playToken={props.playToken}
        onMuteEnter={props.onMuteEnter}
        onMuteExit={props.onMuteExit}
        onEnded={props.onEnded}
      />
    );
  },
);
