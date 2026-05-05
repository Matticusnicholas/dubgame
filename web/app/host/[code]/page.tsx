"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useGame } from "@/lib/use-game";
import { clipPublicUrl } from "@/lib/supabase-browser";
import { ClipPlayer } from "@/components/ClipPlayer";
import { defaultVoice, speak, cancelSpeech, resolveVoice } from "@/lib/tts";
import { VoicePicker } from "@/components/VoicePicker";
import { IntroOverlay, shouldShowIntro } from "@/components/IntroOverlay";
import type { SubmissionRow } from "@/lib/game-state";
import { PHRASE_MAX_LEN } from "@/lib/game-state";

export default function HostPage(props: { params: Promise<{ code: string }> }) {
  const { code } = use(props.params);
  const { game, players, submissions, votes, clip, loading, error } = useGame(code);
  const [hostToken, setHostToken] = useState<string | null>(null);
  const [playerToken, setPlayerToken] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [actionInFlight, setActionInFlight] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [streamSafe, setStreamSafe] = useState(false);
  const dubWindowRef = useRef<Window | null>(null);

  useEffect(() => {
    setHostToken(localStorage.getItem(`host_token:${code}`));
    setPlayerToken(localStorage.getItem(`player_token:${code}`));
    setPlayerId(localStorage.getItem(`player_id:${code}`));
    setStreamSafe(localStorage.getItem("stream_safe_mode") === "1");
  }, [code]);

  function toggleStreamSafe() {
    setStreamSafe((prev) => {
      const next = !prev;
      localStorage.setItem("stream_safe_mode", next ? "1" : "0");
      return next;
    });
  }

  function openDubWindow() {
    // Reuse existing popup if it's still open, otherwise open fresh.
    if (dubWindowRef.current && !dubWindowRef.current.closed) {
      dubWindowRef.current.focus();
      return;
    }
    const w = window.open(
      `/play/${code}`,
      "dub-private",
      "width=420,height=720,resizable=yes,scrollbars=yes,noopener=no",
    );
    dubWindowRef.current = w;
  }

  async function start() {
    if (!hostToken) return;
    setActionError(null);
    setActionInFlight(true);
    try {
      const res = await fetch(`/api/games/${code}/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ host_token: hostToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "Failed");
    } finally {
      setActionInFlight(false);
    }
  }

  async function advance() {
    if (!hostToken) return;
    setActionError(null);
    setActionInFlight(true);
    try {
      const res = await fetch(`/api/games/${code}/advance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ host_token: hostToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "Failed");
    } finally {
      setActionInFlight(false);
    }
  }

  if (loading) return <Centered>Loading…</Centered>;
  if (error) return <Centered>{error}</Centered>;
  if (!game) return <Centered>Game not found.</Centered>;

  if (!hostToken) {
    return (
      <Centered>
        <div className="text-center max-w-md">
          <p className="text-2xl font-bold mb-2">No host token in this browser.</p>
          <p className="opacity-70">Open the game on the device that created it, or create a new game.</p>
          <a href="/" className="inline-block mt-6 underline">Back to home</a>
        </div>
      </Centered>
    );
  }

  return (
    <main className="min-h-screen p-6 md:p-10">
      <header className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <h1 className="text-2xl font-black tracking-tight">Stupid Dubbing</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={toggleStreamSafe}
            className={`text-xs uppercase tracking-wider rounded-full border px-3 py-1.5 transition ${
              streamSafe
                ? "border-white bg-white text-black font-bold"
                : "border-white/20 hover:bg-white/10"
            }`}
            title="Hide your dub & vote on this screen so streamers can show this window safely"
          >
            🎭 Stream-safe {streamSafe ? "ON" : "OFF"}
          </button>
          <div className="text-sm opacity-60">
            Round {game.current_round} / {game.total_rounds}
          </div>
        </div>
      </header>

      {actionError && <div className="mb-4 rounded-xl bg-red-900/40 border border-red-600/40 px-4 py-2 text-red-200">{actionError}</div>}

      {game.state === "lobby" && (
        <Lobby code={code} players={players} onStart={start} disabled={actionInFlight || players.length < 1} />
      )}

      {game.state === "submitting" && clip && (
        <SubmittingHost
          code={code}
          submissions={submissions.filter((s) => s.round === game.current_round)}
          playerCount={players.length}
          clipSrc={clipPublicUrl(clip.file_path)}
          muteStartMs={clip.mute_start_ms}
          muteEndMs={clip.mute_end_ms}
          onContinue={advance}
          continueDisabled={actionInFlight}
          playerToken={playerToken}
          playerId={playerId}
          round={game.current_round}
          streamSafe={streamSafe}
          onOpenDubWindow={openDubWindow}
        />
      )}

      {game.state === "reveal" && clip && (
        <RevealHost
          submissions={submissions.filter((s) => s.round === game.current_round)}
          players={players}
          clipSrc={clipPublicUrl(clip.file_path)}
          muteStartMs={clip.mute_start_ms}
          muteEndMs={clip.mute_end_ms}
          onDone={advance}
          doneDisabled={actionInFlight}
        />
      )}

      {game.state === "voting" && (
        <VotingHost
          code={code}
          submissions={submissions.filter((s) => s.round === game.current_round)}
          players={players}
          votes={votes.filter((v) => v.round === game.current_round)}
          onTally={advance}
          tallyDisabled={actionInFlight}
          playerToken={playerToken}
          playerId={playerId}
          streamSafe={streamSafe}
          onOpenDubWindow={openDubWindow}
        />
      )}

      {game.state === "scoreboard" && (
        <Scoreboard
          players={players}
          isFinal={game.current_round >= game.total_rounds}
          submissions={submissions.filter((s) => s.round === game.current_round)}
          votes={votes.filter((v) => v.round === game.current_round)}
          onContinue={advance}
          continueDisabled={actionInFlight}
        />
      )}

      {game.state === "finished" && (
        <Finished players={players} onPlayAgain={advance} disabled={actionInFlight} />
      )}
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen flex items-center justify-center p-6">{children}</main>;
}

function Lobby({ code, players, onStart, disabled }: { code: string; players: { id: string; nickname: string }[]; onStart: () => void; disabled: boolean }) {
  const [joinUrl, setJoinUrl] = useState<string>("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    setJoinUrl(`${window.location.origin}/?code=${code}`);
  }, [code]);

  function goFullscreen() {
    if (typeof document === "undefined") return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void document.documentElement.requestFullscreen();
    }
  }

  return (
    <section className="grid md:grid-cols-2 gap-8 items-start">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-8 flex flex-col items-center text-center gap-6">
        <div>
          <p className="uppercase tracking-widest text-sm opacity-60 mb-3">Join code</p>
          <p className="text-7xl md:text-9xl font-black tracking-[0.15em] font-mono">{code}</p>
        </div>
        {joinUrl && (
          <div className="bg-white p-4 rounded-2xl">
            <QRCodeSVG value={joinUrl} size={180} level="M" includeMargin={false} />
          </div>
        )}
        <p className="text-sm opacity-70 max-w-xs">Scan with your phone, or open the site and type the code.</p>
        <button
          onClick={goFullscreen}
          className="text-xs uppercase tracking-widest opacity-60 hover:opacity-100 underline"
        >
          ⛶ Fullscreen on this display
        </button>
        <p className="text-xs opacity-40 max-w-xs">
          On a TV? In Chrome, use the ⋮ menu → Cast → pick your TV. Or plug your laptop into the TV with HDMI and hit Fullscreen above.
        </p>
      </div>
      <div className="rounded-3xl border border-white/10 bg-white/5 p-8">
        <h2 className="text-2xl font-bold mb-4">Players ({players.length})</h2>
        {players.length === 0 ? (
          <p className="opacity-60">Waiting for someone to join…</p>
        ) : (
          <ul className="space-y-2">
            {players.map((p) => (
              <li key={p.id} className="rounded-xl bg-black/30 px-4 py-2">{p.nickname}</li>
            ))}
          </ul>
        )}
        <button
          onClick={onStart}
          disabled={disabled}
          className="mt-6 w-full rounded-xl bg-white text-black font-bold py-3 hover:bg-white/90"
        >
          Start game
        </button>
      </div>
    </section>
  );
}

function SubmittingHost(props: {
  code: string;
  submissions: SubmissionRow[];
  playerCount: number;
  clipSrc: string;
  muteStartMs: number;
  muteEndMs: number;
  onContinue: () => void;
  continueDisabled: boolean;
  playerToken: string | null;
  playerId: string | null;
  round: number;
  streamSafe: boolean;
  onOpenDubWindow: () => void;
}) {
  const PLAYS_PER_ROUND = 2;
  const [playToken, setPlayToken] = useState<number | null>(null);
  const [playsDone, setPlaysDone] = useState(0);
  // Show the intro on the very first round, unless dismissed-permanently.
  const [showIntro, setShowIntro] = useState<boolean>(false);

  useEffect(() => {
    if (props.round === 1 && shouldShowIntro()) setShowIntro(true);
  }, [props.round]);

  // Reset playback state on a new round.
  useEffect(() => {
    setPlayToken(null);
    setPlaysDone(0);
  }, [props.clipSrc, props.round]);

  function onEnded() {
    const next = playsDone + 1;
    setPlaysDone(next);
    if (next < PLAYS_PER_ROUND) {
      // Tiny gap before the second play so the cut isn't jarring.
      setTimeout(() => setPlayToken(Date.now()), 600);
    }
  }

  function startOrReplay() {
    setPlaysDone(0);
    setPlayToken(Date.now());
  }

  const playing = playToken != null && playsDone < PLAYS_PER_ROUND;
  const showStart = playToken == null;
  return (
    <section className="grid md:grid-cols-[2fr_1fr] gap-6">
      <div className="aspect-video w-full rounded-2xl overflow-hidden bg-black relative">
        {showIntro && <IntroOverlay onDone={() => setShowIntro(false)} />}
        <ClipPlayer
          src={props.clipSrc}
          muteStartMs={props.muteStartMs}
          muteEndMs={props.muteEndMs}
          playToken={playToken}
          onEnded={onEnded}
          muteOverlay={
            <div className="bg-black/80 px-8 py-4 rounded-2xl text-3xl md:text-5xl font-black tracking-wider animate-pulse">
              🔇  DUB THIS PART
            </div>
          }
        />
        {showStart && (
          <button
            onClick={startOrReplay}
            className="absolute inset-0 flex items-center justify-center bg-black/40 text-2xl font-bold"
          >
            ▶  Play clip ({PLAYS_PER_ROUND}×)
          </button>
        )}
        {!showStart && !playing && (
          <button
            onClick={startOrReplay}
            className="absolute bottom-4 right-4 rounded-xl bg-white/20 hover:bg-white/30 px-4 py-2 text-sm font-bold"
          >
            ↻ Replay
          </button>
        )}
        {playing && (
          <div className="absolute top-4 right-4 rounded-full bg-black/70 px-3 py-1 text-xs font-mono">
            play {Math.min(playsDone + 1, PLAYS_PER_ROUND)} / {PLAYS_PER_ROUND}
          </div>
        )}
      </div>
      <aside className="rounded-2xl border border-white/10 bg-white/5 p-6 flex flex-col gap-4">
        <div>
          <p className="uppercase tracking-widest text-xs opacity-60">Code</p>
          <p className="text-4xl font-mono font-black tracking-widest">{props.code}</p>
        </div>
        <p className="text-2xl font-bold">{props.submissions.length} / {props.playerCount} submitted</p>

        {props.playerToken && props.playerId && !props.streamSafe && (
          <HostSubmitForm
            code={props.code}
            playerToken={props.playerToken}
            playerId={props.playerId}
            round={props.round}
            existing={(() => {
              const s = props.submissions.find((s) => s.player_id === props.playerId);
              return s ? { phrase: s.phrase, voice: s.voice ?? "random" } : null;
            })()}
          />
        )}
        {props.streamSafe && (
          <button
            onClick={props.onOpenDubWindow}
            className="rounded-xl bg-white/15 hover:bg-white/25 font-bold py-3 text-sm border border-dashed border-white/30"
            title="Opens a small popup window with your typing/voting controls — drag it off-screen so streamers can show the main window"
          >
            🪟 Open private dub window
          </button>
        )}

        <button
          onClick={props.onContinue}
          disabled={props.continueDisabled || props.submissions.length === 0}
          className="mt-auto rounded-xl bg-white text-black font-bold py-3 hover:bg-white/90"
        >
          Reveal dubs →
        </button>
      </aside>
    </section>
  );
}

function HostSubmitForm(props: {
  code: string;
  playerToken: string;
  playerId: string;
  round: number;
  existing: { phrase: string; voice: string } | null;
}) {
  const [phrase, setPhrase] = useState(props.existing?.phrase ?? "");
  const [voice, setVoice] = useState<string>(props.existing?.voice ?? "random");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Sync if the existing submission changes (e.g., new round).
  useEffect(() => {
    setPhrase(props.existing?.phrase ?? "");
    setVoice(props.existing?.voice ?? "random");
  }, [props.existing?.phrase, props.existing?.voice, props.round]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!phrase.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/games/${props.code}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ player_token: props.playerToken, phrase: phrase.trim(), voice }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setSavedAt(Date.now());
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const submitted = !!props.existing;
  return (
    <form onSubmit={send} className="flex flex-col gap-2 border-t border-white/10 pt-4">
      <span className="text-xs uppercase tracking-wider opacity-60">Your dub</span>
      <textarea
        value={phrase}
        onChange={(e) => setPhrase(e.target.value.slice(0, PHRASE_MAX_LEN))}
        maxLength={PHRASE_MAX_LEN}
        rows={2}
        placeholder="They're coming to get you, Barbara"
        className="rounded-xl bg-black/40 px-3 py-2 outline-none focus:ring-2 focus:ring-white/40 resize-none"
      />
      <div className="flex justify-between items-center text-xs opacity-60">
        <span>{phrase.length} / {PHRASE_MAX_LEN}</span>
        {submitted && <span>✓ submitted (you can edit)</span>}
        {savedAt && <span>saved</span>}
      </div>
      <VoicePicker value={voice} onChange={setVoice} disabled={busy} />
      <button
        type="submit"
        disabled={busy || phrase.trim().length === 0}
        className="rounded-xl bg-white/15 hover:bg-white/25 font-bold py-2 text-sm"
      >
        {submitted ? "Update" : "Submit dub"}
      </button>
      {err && <p className="text-red-400 text-xs">{err}</p>}
    </form>
  );
}

function RevealHost(props: {
  submissions: SubmissionRow[];
  players: { id: string; nickname: string }[];
  clipSrc: string;
  muteStartMs: number;
  muteEndMs: number;
  onDone: () => void;
  doneDisabled: boolean;
}) {
  const playerById = useMemo(() => new Map(props.players.map((p) => [p.id, p])), [props.players]);
  const [idx, setIdx] = useState(0);
  const [playToken, setPlayToken] = useState<number | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const playGenerationRef = useRef(0);
  const speakingRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const current = props.submissions[idx] ?? null;

  useEffect(() => {
    return () => cancelSpeech();
  }, []);

  // Fires when video crosses into mute_start. Don't pause — let video keep playing
  // visually while TTS reads the dub. We'll only pause if TTS is still speaking
  // when video reaches mute_end (handled in onMuteExit).
  async function onMuteEnter() {
    if (!current) return;
    const generation = playGenerationRef.current;
    speakingRef.current = true;
    setSpeaking(true);
    const browserVoice = await defaultVoice();
    const variant = resolveVoice(current.voice ?? "random");
    await speak(current.phrase, { voice: browserVoice, rate: variant.rate, pitch: variant.pitch });
    if (generation !== playGenerationRef.current) return;
    speakingRef.current = false;
    setSpeaking(false);
    // If we paused at mute_end waiting for TTS, resume now.
    const video = videoRef.current;
    if (video && video.paused && video.currentTime * 1000 >= props.muteEndMs - 50) {
      video.volume = 1;
      void video.play();
    }
  }

  // Fires when video naturally reaches mute_end. If the dub TTS is still going,
  // freeze on this last frame until it finishes; otherwise let the video continue.
  function onMuteExit() {
    if (!speakingRef.current) return;
    const video = videoRef.current;
    if (!video) return;
    video.pause();
  }

  function playCurrent() {
    playGenerationRef.current += 1;
    setPlayToken(Date.now());
  }

  function next() {
    cancelSpeech();
    speakingRef.current = false;
    setSpeaking(false);
    playGenerationRef.current += 1;
    if (idx + 1 < props.submissions.length) {
      setIdx((i) => i + 1);
      setPlayToken(null);
    } else {
      props.onDone();
    }
  }

  if (!current) {
    return (
      <Centered>
        <div className="text-center">
          <p className="text-2xl font-bold mb-4">No submissions to reveal.</p>
          <button onClick={props.onDone} className="rounded-xl bg-white text-black font-bold py-3 px-6">Continue</button>
        </div>
      </Centered>
    );
  }

  return (
    <section className="grid md:grid-cols-[2fr_1fr] gap-6">
      <div className="aspect-video w-full rounded-2xl overflow-hidden bg-black relative">
        <ClipPlayer
          ref={videoRef}
          src={props.clipSrc}
          muteStartMs={props.muteStartMs}
          muteEndMs={props.muteEndMs}
          onMuteEnter={onMuteEnter}
          onMuteExit={onMuteExit}
          playToken={playToken}
        />
        {playToken == null && (
          <button
            onClick={playCurrent}
            className="absolute inset-0 flex items-center justify-center bg-black/40 text-2xl font-bold"
          >
            ▶  Play dub {idx + 1} of {props.submissions.length}
          </button>
        )}
        {speaking && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/80 px-6 py-3 rounded-xl text-xl">
            {resolveVoice(current.voice ?? "random").emoji}  {current.phrase}
          </div>
        )}
      </div>
      <aside className="rounded-2xl border border-white/10 bg-white/5 p-6 flex flex-col gap-4">
        <p className="uppercase tracking-widest text-xs opacity-60">Now playing</p>
        <p className="text-2xl font-bold">{playerById.get(current.player_id)?.nickname ?? "?"}</p>
        <p className="text-lg italic opacity-80">"{current.phrase}"</p>
        <p className="text-sm opacity-50">{idx + 1} / {props.submissions.length}</p>
        <button
          onClick={next}
          disabled={props.doneDisabled}
          className="mt-auto rounded-xl bg-white text-black font-bold py-3 hover:bg-white/90"
        >
          {idx + 1 < props.submissions.length ? "Next dub →" : "Open voting →"}
        </button>
      </aside>
    </section>
  );
}

function VotingHost(props: {
  code: string;
  submissions: SubmissionRow[];
  players: { id: string; nickname: string }[];
  votes: { voter_id: string; voted_for_submission_id: string }[];
  onTally: () => void;
  tallyDisabled: boolean;
  playerToken: string | null;
  playerId: string | null;
  streamSafe: boolean;
  onOpenDubWindow: () => void;
}) {
  const myVote = props.playerId ? props.votes.find((v) => v.voter_id === props.playerId) : undefined;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function vote(submissionId: string) {
    if (!props.playerToken || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/games/${props.code}/vote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ player_token: props.playerToken, submission_id: submissionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <header className="flex justify-between items-baseline mb-4">
        <h2 className="text-3xl font-black">Vote!</h2>
        <p className="opacity-70">{props.votes.length} / {props.players.length} voted</p>
      </header>
      {props.streamSafe ? (
        <div className="mb-4 flex flex-col gap-2">
          <p className="text-sm opacity-60">Vote on your phones (or pop out a private window).</p>
          <button
            onClick={props.onOpenDubWindow}
            className="self-start rounded-xl bg-white/15 hover:bg-white/25 font-bold py-2 px-4 text-sm border border-dashed border-white/30"
          >
            🪟 Open private dub window
          </button>
        </div>
      ) : (
        <p className="text-sm opacity-60 mb-4">Click your favourite (you can't pick your own).</p>
      )}
      <ul className="grid md:grid-cols-2 gap-4">
        {props.submissions.map((s, i) => {
          const isMine = props.playerId === s.player_id;
          const isChosen = myVote?.voted_for_submission_id === s.id;
          // In stream-safe mode, never reveal whether the host already voted (would spoil their pick on stream).
          const showChosenHighlight = isChosen && !props.streamSafe;
          const canVote = props.playerToken && !isMine && !props.streamSafe;
          return (
            <li key={s.id}>
              <button
                onClick={() => canVote && vote(s.id)}
                disabled={!canVote || busy}
                className={`w-full text-left rounded-2xl border p-6 transition ${
                  showChosenHighlight ? "border-white bg-white text-black" :
                  isMine && !props.streamSafe ? "border-white/10 bg-white/5 opacity-50" :
                  "border-white/10 bg-white/5 hover:bg-white/10"
                }`}
              >
                <p className="text-xs opacity-50 mb-2">DUB #{i + 1}{isMine && !props.streamSafe ? " (yours)" : ""}</p>
                <p className="text-2xl font-bold">"{s.phrase}"</p>
              </button>
            </li>
          );
        })}
      </ul>
      {err && <p className="text-red-400 mt-4 text-sm">{err}</p>}
      <div className="mt-8 flex justify-end">
        <button
          onClick={props.onTally}
          disabled={props.tallyDisabled || props.votes.length === 0}
          className="rounded-xl bg-white text-black font-bold py-3 px-6 hover:bg-white/90"
        >
          Tally votes →
        </button>
      </div>
    </section>
  );
}

function Scoreboard(props: {
  players: { id: string; nickname: string; score: number }[];
  isFinal: boolean;
  submissions: SubmissionRow[];
  votes: { voted_for_submission_id: string }[];
  onContinue: () => void;
  continueDisabled: boolean;
}) {
  const ranked = [...props.players].sort((a, b) => b.score - a.score);
  const tally = new Map<string, number>();
  for (const v of props.votes) tally.set(v.voted_for_submission_id, (tally.get(v.voted_for_submission_id) ?? 0) + 1);
  const winnerSub = props.submissions.length > 0
    ? props.submissions.reduce((best, s) => ((tally.get(s.id) ?? 0) > (tally.get(best.id) ?? 0) ? s : best), props.submissions[0])
    : null;
  const winnerVotes = winnerSub ? (tally.get(winnerSub.id) ?? 0) : 0;
  const winnerName = winnerSub ? props.players.find((p) => p.id === winnerSub.player_id)?.nickname : null;

  return (
    <section className="grid md:grid-cols-2 gap-8 items-start">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-8">
        <p className="uppercase tracking-widest text-xs opacity-60">Round winner</p>
        {winnerSub && winnerVotes > 0 ? (
          <>
            <p className="text-4xl font-black mt-2">{winnerName}</p>
            <p className="text-xl italic opacity-80 mt-2">"{winnerSub.phrase}"</p>
            <p className="opacity-60 mt-2">{winnerVotes} vote{winnerVotes === 1 ? "" : "s"}</p>
          </>
        ) : (
          <p className="text-2xl mt-2">No votes this round.</p>
        )}
      </div>
      <div className="rounded-3xl border border-white/10 bg-white/5 p-8">
        <h2 className="text-2xl font-bold mb-4">Scoreboard</h2>
        <ol className="space-y-2">
          {ranked.map((p, i) => (
            <li key={p.id} className="flex justify-between items-center rounded-xl bg-black/30 px-4 py-2">
              <span><span className="opacity-50 mr-3">{i + 1}.</span>{p.nickname}</span>
              <span className="font-bold">{p.score}</span>
            </li>
          ))}
        </ol>
        <button
          onClick={props.onContinue}
          disabled={props.continueDisabled}
          className="mt-6 w-full rounded-xl bg-white text-black font-bold py-3 hover:bg-white/90"
        >
          {props.isFinal ? "Show final scores →" : "Next round →"}
        </button>
      </div>
    </section>
  );
}

function Finished(props: { players: { id: string; nickname: string; score: number }[]; onPlayAgain: () => void; disabled: boolean }) {
  const ranked = [...props.players].sort((a, b) => b.score - a.score);
  const winner = ranked[0];
  return (
    <section className="max-w-2xl mx-auto text-center mt-10">
      <p className="uppercase tracking-widest text-sm opacity-60">Final results</p>
      <p className="text-6xl md:text-8xl font-black mt-4">{winner?.nickname ?? "—"}</p>
      <p className="text-xl opacity-70 mt-2">{winner?.score ?? 0} points</p>
      <ol className="mt-10 space-y-2 text-left">
        {ranked.map((p, i) => (
          <li key={p.id} className="flex justify-between items-center rounded-xl bg-white/5 border border-white/10 px-4 py-3">
            <span><span className="opacity-50 mr-3">{i + 1}.</span>{p.nickname}</span>
            <span className="font-bold">{p.score}</span>
          </li>
        ))}
      </ol>
      <button
        onClick={props.onPlayAgain}
        disabled={props.disabled}
        className="mt-8 rounded-xl bg-white text-black font-bold py-3 px-6 hover:bg-white/90"
      >
        Play again
      </button>
    </section>
  );
}
