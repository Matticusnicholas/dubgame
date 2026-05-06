"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { track } from "@vercel/analytics";
import { getBrowserClient, clipPublicUrl } from "@/lib/supabase-browser";
import { PACK_CATALOG, PHRASE_MAX_LEN, type ClipRow } from "@/lib/game-state";
import { UniversalClipPlayer, type UniversalClipPlayerHandle } from "@/components/UniversalClipPlayer";
import { VoicePicker } from "@/components/VoicePicker";
import { VoiceRecorder, type RecordedVoice } from "@/components/VoiceRecorder";
import { defaultVoice, speak, cancelSpeech, resolveVoice } from "@/lib/tts";
import { isKokoroLoaded, pickKokoroVoiceForVariant, speakWithKokoro } from "@/lib/tts-kokoro";
import { KokoroToggle } from "@/components/KokoroToggle";
import { getSeenClipIds, appendSeenClipIds } from "@/lib/seen-clips";
import { buildDubbedClip, downloadBlob } from "@/lib/save-dub";

export default function SoloPage() {
  const [pack, setPack] = useState<string>("notld");
  const [clip, setClip] = useState<ClipRow | null>(null);
  const [loadingClip, setLoadingClip] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [phrase, setPhrase] = useState("");
  const [voice, setVoice] = useState<string>("random");
  const [recording, setRecording] = useState<RecordedVoice | null>(null);

  const [playToken, setPlayToken] = useState<string | null>(null);
  const [playMode, setPlayMode] = useState<"preview" | "dub">("preview");
  const playModeRef = useRef<"preview" | "dub">("preview");
  const [speaking, setSpeaking] = useState(false);
  const speakingRef = useRef(false);
  const wasPausedRef = useRef(false);
  const playerRef = useRef<UniversalClipPlayerHandle>(null);
  const playGenRef = useRef(0);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [kokoroReady, setKokoroReady] = useState(false);

  // Pack changes → fetch a fresh clip and reset all dub state
  useEffect(() => {
    void loadRandomClip(pack, /* forceReset */ true);
  }, [pack]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => cancelSpeech(), []);

  async function loadRandomClip(packId: string, forceReset = false) {
    setLoadingClip(true);
    setError(null);
    try {
      const sb = getBrowserClient();
      const seen = getSeenClipIds();
      // Try to pick something the user hasn't seen yet within this pack.
      let q = sb.from("clips").select("*").eq("package", packId);
      if (seen.length > 0) {
        q = q.not("id", "in", `(${seen.map((id) => `"${id}"`).join(",")})`);
      }
      const { data, error: fetchErr } = await q.limit(50);
      if (fetchErr) throw new Error(fetchErr.message);

      let pool = (data ?? []) as ClipRow[];
      if (pool.length === 0) {
        // Rolled the whole pack — fall back to fresh-but-with-repeats so the user can keep playing.
        const { data: all, error: e2 } = await sb.from("clips").select("*").eq("package", packId).limit(50);
        if (e2) throw new Error(e2.message);
        pool = (all ?? []) as ClipRow[];
      }
      if (pool.length === 0) {
        setClip(null);
        setError("No clips in this pack yet. Try a different one.");
        return;
      }
      const picked = pool[Math.floor(Math.random() * pool.length)];
      setClip(picked);
      appendSeenClipIds([picked.id]);

      if (forceReset) {
        setPhrase("");
        setVoice("random");
        setRecording(null);
      }
      setPlayToken(null);
      setSpeaking(false);
      speakingRef.current = false;
      wasPausedRef.current = false;
      playGenRef.current += 1;
      cancelSpeech();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load clip");
    } finally {
      setLoadingClip(false);
    }
  }

  function previewClip() {
    if (!clip) return;
    setError(null);
    cancelSpeech();
    speakingRef.current = false;
    setSpeaking(false);
    wasPausedRef.current = false;
    playGenRef.current += 1;
    playModeRef.current = "preview";
    setPlayMode("preview");
    setPlayToken(`preview-${Date.now()}`);
  }

  async function dubIt() {
    if (!clip) return;
    if (!phrase.trim() && !recording) {
      setError("Type a dub or record a voice first");
      return;
    }
    setError(null);
    cancelSpeech();
    speakingRef.current = false;
    setSpeaking(false);
    wasPausedRef.current = false;
    track("solo_dub_played", { pack, voice, with_recording: recording ? 1 : 0 });
    playGenRef.current += 1;
    playModeRef.current = "dub";
    setPlayMode("dub");
    setPlayToken(`dub-${Date.now()}`);
  }

  async function onMuteEnter() {
    if (!clip) return;
    if (playModeRef.current !== "dub") return; // preview mode: just play through the muted gap silently
    const gen = playGenRef.current;
    speakingRef.current = true;
    setSpeaking(true);
    try {
      if (recording) {
        const url = URL.createObjectURL(recording.blob);
        const a = new Audio(url);
        await a.play();
        await new Promise<void>((resolve) => {
          a.onended = () => resolve();
          a.onerror = () => resolve();
        });
        URL.revokeObjectURL(url);
      } else if (kokoroReady && isKokoroLoaded()) {
        const k = pickKokoroVoiceForVariant(voice);
        await speakWithKokoro(phrase.trim(), { voice: k.voice, rate: k.rate });
      } else {
        const browserVoice = await defaultVoice();
        const variant = resolveVoice(voice);
        await speak(phrase.trim(), { voice: browserVoice, rate: variant.rate, pitch: variant.pitch });
      }
    } catch {
      /* ignore */
    }
    if (gen !== playGenRef.current) return;
    speakingRef.current = false;
    setSpeaking(false);
    if (wasPausedRef.current) {
      wasPausedRef.current = false;
      playerRef.current?.play();
    }
  }

  function onMuteExit() {
    if (!speakingRef.current) return;
    wasPausedRef.current = true;
    playerRef.current?.pause();
  }

  async function saveDubMp4() {
    if (!clip || !recording || clip.youtube_id) return;
    setError(null);
    setSaving(true);
    setSaveStatus("Loading dub engine…");
    try {
      const blob = await buildDubbedClip({
        sourceUrl: clipPublicUrl(clip.file_path),
        dubAudioBlob: recording.blob,
        muteStartMs: clip.mute_start_ms,
        muteEndMs: clip.mute_end_ms,
        onProgress: (m) => setSaveStatus(m),
      });
      const safeTitle = (clip.title ?? clip.id).replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 40);
      downloadBlob(blob, `dub_${safeTitle}.mp4`);
      track("solo_dub_saved", { pack });
      setSaveStatus(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen p-4 md:p-8 max-w-3xl mx-auto flex flex-col gap-5">
      <header className="flex items-center justify-between">
        <Link href="/" className="text-sm opacity-60 hover:opacity-100">← back</Link>
        <h1 className="text-2xl md:text-3xl font-black tracking-tight">Solo dubbing</h1>
        <span className="text-xs opacity-50">no friends required 🤘</span>
      </header>

      <p className="text-sm opacity-70">
        Type or record a dub, hit Play, hear it land in the muted gap. No voting, no scoring,
        no host. Just for fun.
      </p>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wider opacity-60">Pack</span>
          <select
            value={pack}
            onChange={(e) => setPack(e.target.value)}
            className="rounded-xl bg-black/40 px-4 py-3 outline-none focus:ring-2 focus:ring-white/40 appearance-none"
          >
            {PACK_CATALOG.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </label>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs uppercase tracking-wider opacity-60">Voice engine</span>
          <KokoroToggle onChange={setKokoroReady} />
        </div>
      </div>

      <div
        onClick={() => !loadingClip && clip && previewClip()}
        className={`aspect-video w-full rounded-2xl overflow-hidden bg-black relative ${
          !loadingClip && clip ? "cursor-pointer" : ""
        }`}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && clip) {
            e.preventDefault();
            previewClip();
          }
        }}
      >
        {loadingClip && (
          <div className="absolute inset-0 flex items-center justify-center text-sm opacity-60">Loading clip…</div>
        )}
        {!loadingClip && clip && (
          <>
            <UniversalClipPlayer
              ref={playerRef}
              clip={clip}
              src={clipPublicUrl(clip.file_path)}
              playToken={playToken}
              onMuteEnter={onMuteEnter}
              onMuteExit={onMuteExit}
              muteOverlay={
                <div className="bg-black/80 px-6 py-3 rounded-xl text-2xl md:text-4xl font-black tracking-wider animate-pulse">
                  🔇 DUB THIS PART
                </div>
              }
            />
            {speaking && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 max-w-[88%] bg-black/85 px-4 py-2 rounded-xl text-base md:text-xl text-center">
                {recording ? "🎤" : "🗣️"} {phrase || "(voice recording)"}
              </div>
            )}
            {clip.title && clip.channel_url && (
              <a
                href={clip.channel_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="absolute top-2 left-2 bg-black/70 hover:bg-black/90 px-3 py-1 rounded-full text-xs opacity-90"
                title="Open the original creator's channel in a new tab"
              >
                {clip.channel_name ? `📺 ${clip.channel_name}` : "📺 source"}
              </a>
            )}
            {playToken == null && !speaking && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="bg-black/70 px-5 py-2.5 rounded-full text-base md:text-lg font-bold">▶ Tap to play</div>
              </div>
            )}
          </>
        )}
      </div>

      {clip && (
        <section className="rounded-2xl border border-white/10 bg-white/5 p-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wider opacity-60">Your dub</span>
            <textarea
              value={phrase}
              onChange={(e) => setPhrase(e.target.value.slice(0, PHRASE_MAX_LEN))}
              maxLength={PHRASE_MAX_LEN}
              rows={2}
              placeholder="They're coming to get you, Barbara"
              className="rounded-xl bg-black/40 px-3 py-2 outline-none focus:ring-2 focus:ring-white/40 resize-none"
            />
            <span className="text-xs opacity-50 text-right">{phrase.length} / {PHRASE_MAX_LEN}</span>
          </label>

          <div className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-wider opacity-60">Voice</span>
            <VoicePicker value={voice} onChange={setVoice} disabled={!!recording} />
            {recording && (
              <p className="text-xs opacity-50 italic">Voice picker is ignored when you record yourself.</p>
            )}
          </div>

          <VoiceRecorder value={recording} onChange={setRecording} />

          <div className="flex flex-col gap-2 mt-2">
            <div className="flex gap-2">
              <button
                onClick={previewClip}
                className="flex-1 rounded-xl bg-white/10 hover:bg-white/20 font-bold py-3"
              >
                ▶ Preview clip
              </button>
              <button
                onClick={() => loadRandomClip(pack, true)}
                className="rounded-xl bg-white/10 hover:bg-white/20 font-bold py-3 px-5"
                title="Skip to a different random clip"
              >
                ⏭ Next clip
              </button>
            </div>
            <button
              onClick={dubIt}
              disabled={!phrase.trim() && !recording}
              className="rounded-xl bg-white text-black font-bold py-3"
            >
              🎬 Play with my dub
            </button>
          </div>

          {clip && (() => {
            const isYT = !!clip.youtube_id;
            const canSave = !isYT && !!recording;
            return (
              <div className="border-t border-white/10 pt-3 mt-1">
                <button
                  onClick={() => canSave && saveDubMp4()}
                  disabled={!canSave || saving}
                  className={`w-full rounded-xl font-bold py-2.5 text-sm ${
                    canSave ? "bg-white/15 hover:bg-white/25" : "bg-white/5 opacity-50 cursor-not-allowed"
                  }`}
                  title={
                    isYT ? "YouTube embeds can't be saved to mp4 (cross-origin restriction)"
                    : !recording ? "Record a voice first — browser TTS audio can't be captured"
                    : "Save the dubbed clip as mp4 (~30 MB engine downloads on first use)"
                  }
                >
                  {saving
                    ? (saveStatus ?? "Saving…")
                    : isYT
                      ? "💾 Save not supported for YouTube clips"
                      : !recording
                        ? "💾 Save: needs a voice recording (TTS can't be captured)"
                        : "💾 Save dubbed clip as mp4"}
                </button>
                {saveStatus && saving && (
                  <p className="text-xs opacity-60 mt-1.5 text-center">{saveStatus}</p>
                )}
              </div>
            );
          })()}

          {error && <p className="text-sm text-red-400">{error}</p>}
        </section>
      )}

      <footer className="text-xs opacity-40 text-center mt-2">
        Want to play with friends? <Link href="/" className="underline">Host a real game →</Link>
      </footer>
    </main>
  );
}
