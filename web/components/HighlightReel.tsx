"use client";

import { useEffect, useRef, useState } from "react";
import { track } from "@/lib/track";
import type { RoundWinner } from "@/lib/winners";
import { ClipPlayer } from "@/components/ClipPlayer";
import { defaultVoice, speak, cancelSpeech, resolveVoice } from "@/lib/tts";
import { isKokoroLoaded } from "@/lib/tts-kokoro";
import { playSubmission } from "@/lib/tts-prefetch";
import { clipPublicUrl } from "@/lib/supabase-browser";

export function HighlightReel({
  winners,
  useKokoro,
  onDone,
}: {
  winners: RoundWinner[];
  useKokoro: boolean;
  onDone: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [playToken, setPlayToken] = useState<number | null>(Date.now());
  const [speaking, setSpeaking] = useState(false);
  const playGenerationRef = useRef(0);
  const speakingRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const current = winners[idx] ?? null;

  useEffect(() => {
    return () => cancelSpeech();
  }, []);

  // Each time we advance to a new winner, kick playback.
  useEffect(() => {
    cancelSpeech();
    speakingRef.current = false;
    setSpeaking(false);
    playGenerationRef.current += 1;
    setPlayToken(Date.now());
  }, [idx]);

  async function onMuteEnter() {
    if (!current) return;
    const generation = playGenerationRef.current;
    speakingRef.current = true;
    setSpeaking(true);
    try {
      if (current.submission.voice_url) {
        const a = new Audio(current.submission.voice_url);
        await a.play();
        await new Promise<void>((resolve) => {
          a.onended = () => resolve();
          a.onerror = () => resolve();
        });
      } else if (useKokoro && isKokoroLoaded()) {
        await playSubmission({
          id: current.submission.id,
          phrase: current.submission.phrase,
          voice: current.submission.voice,
        });
      } else {
        const browserVoice = await defaultVoice();
        const variant = resolveVoice(current.submission.voice ?? "random");
        await speak(current.submission.phrase, { voice: browserVoice, rate: variant.rate, pitch: variant.pitch });
      }
    } catch (e) {
      console.error("Reel TTS failed:", e);
    }
    if (generation !== playGenerationRef.current) return;
    speakingRef.current = false;
    setSpeaking(false);
    const video = videoRef.current;
    if (video && video.paused && video.currentTime * 1000 >= current.clip.mute_end_ms - 50) {
      video.volume = 1;
      void video.play();
    }
  }

  function onMuteExit() {
    if (!speakingRef.current) return;
    const video = videoRef.current;
    if (!video) return;
    video.pause();
  }

  function next() {
    cancelSpeech();
    speakingRef.current = false;
    setSpeaking(false);
    if (idx + 1 < winners.length) {
      setIdx((i) => i + 1);
    } else {
      onDone();
    }
  }

  function skipAll() {
    cancelSpeech();
    track("highlight_reel_skipped", { at: idx, total: winners.length });
    onDone();
  }

  if (!current) {
    onDone();
    return null;
  }

  return (
    <section className="grid md:grid-cols-[2fr_1fr] gap-6">
      <div className="aspect-video w-full rounded-2xl overflow-hidden bg-black relative">
        <ClipPlayer
          ref={videoRef}
          src={clipPublicUrl(current.clip.file_path)}
          muteStartMs={current.clip.mute_start_ms}
          muteEndMs={current.clip.mute_end_ms}
          playToken={playToken}
          onMuteEnter={onMuteEnter}
          onMuteExit={onMuteExit}
          onEnded={next}
          subtitles={current.clip.subtitles ?? []}
        />
        {speaking && (current.submission.phrase || current.submission.voice_url) && (
          <div className="absolute bottom-24 left-1/2 -translate-x-1/2 max-w-[80%] bg-black/80 px-6 py-3 rounded-xl text-xl text-center">
            {current.submission.phrase
              ? `"${current.submission.phrase}"`
              : "🎤 voice recording"}
          </div>
        )}
        <div className="absolute top-4 left-4 bg-black/70 rounded-full px-4 py-1.5 text-sm font-mono">
          Round {current.round}
        </div>
        <div className="absolute top-4 right-4 bg-black/70 rounded-full px-4 py-1.5 text-sm">
          {idx + 1} / {winners.length}
        </div>
        {/* Lower-third nameplate — always visible on the video, broadcast style */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent pt-8 pb-4 px-6">
          <div className="flex items-end justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="text-3xl">🏆</div>
              <div>
                <p className="text-3xl md:text-4xl font-black tracking-tight leading-none">
                  {current.player?.nickname ?? "?"}
                </p>
                <p className="text-xs uppercase tracking-widest opacity-70 mt-1">
                  Round {current.round} winner · {current.voteCount} vote{current.voteCount === 1 ? "" : "s"}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
      <aside className="rounded-2xl border border-white/10 bg-white/5 p-6 flex flex-col gap-3">
        <p className="uppercase tracking-widest text-xs opacity-60">🎬 Highlight reel</p>
        <p className="text-3xl font-black">{current.player?.nickname ?? "?"}</p>
        {current.submission.phrase ? (
          <p className="text-lg italic opacity-80">"{current.submission.phrase}"</p>
        ) : (
          <p className="text-lg italic opacity-60">🎤 voice recording</p>
        )}
        <p className="text-sm opacity-60">
          Round {current.round} winner · {current.voteCount} vote{current.voteCount === 1 ? "" : "s"}
        </p>
        <div className="mt-auto flex flex-col gap-2">
          <button
            onClick={next}
            className="rounded-xl bg-white text-black font-bold py-3 hover:bg-white/90"
          >
            {idx + 1 < winners.length ? "Next →" : "Final scores →"}
          </button>
          <button
            onClick={skipAll}
            className="rounded-xl bg-white/10 hover:bg-white/20 text-sm py-2 opacity-70"
          >
            ⏭ Skip whole reel
          </button>
        </div>
      </aside>
    </section>
  );
}
