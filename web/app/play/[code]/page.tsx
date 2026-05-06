"use client";

import { use, useEffect, useMemo, useState } from "react";
import { track } from "@vercel/analytics";
import type { SubmissionRow } from "@/lib/game-state";
import { PHRASE_MAX_LEN } from "@/lib/game-state";
import { VoicePicker } from "@/components/VoicePicker";
import { VoiceRecorder, type RecordedVoice } from "@/components/VoiceRecorder";
import { ChatPanel } from "@/components/ChatPanel";
import { useGame } from "@/lib/use-game";
import { clipPublicUrl } from "@/lib/supabase-browser";
import { UniversalClipPlayer } from "@/components/UniversalClipPlayer";

export default function PlayPage(props: { params: Promise<{ code: string }> }) {
  const { code } = use(props.params);
  const { game, players, submissions, votes, clip, loading, error } = useGame(code);
  const [playerToken, setPlayerToken] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [nickname, setNickname] = useState<string | null>(null);

  useEffect(() => {
    setPlayerToken(localStorage.getItem(`player_token:${code}`));
    setPlayerId(localStorage.getItem(`player_id:${code}`));
    setNickname(localStorage.getItem(`nickname:${code}`));
  }, [code]);

  if (loading) return <Centered>Loading…</Centered>;
  if (error) return <Centered>{error}</Centered>;
  if (!game) return <Centered>Game not found.</Centered>;
  if (!playerToken || !playerId) {
    return (
      <Centered>
        <div className="text-center max-w-md">
          <p className="text-2xl font-bold mb-2">You're not in this game on this device.</p>
          <a href="/" className="inline-block mt-6 underline">Go back and join</a>
        </div>
      </Centered>
    );
  }

  const me = players.find((p) => p.id === playerId);

  return (
    <main className="min-h-screen p-4 max-w-md mx-auto flex flex-col gap-4">
      <header className="flex items-center justify-between text-sm opacity-70">
        <span>Code <span className="font-mono font-bold">{code}</span></span>
        <span>{nickname ?? me?.nickname}</span>
      </header>

      {game.state === "lobby" && (
        <Card>
          <p className="text-xl font-bold mb-2">Welcome, {me?.nickname ?? nickname}</p>
          <p className="opacity-70">Waiting for the host to start…</p>
          <p className="text-xs opacity-50 mt-4">{players.length} player{players.length === 1 ? "" : "s"} in lobby</p>
        </Card>
      )}

      {game.state === "submitting" && clip && (
        <Card>
          <p className="text-xs uppercase tracking-widest opacity-60 mb-2">Watch the clip</p>
          <div className="aspect-video w-full rounded-xl overflow-hidden bg-black">
            <UniversalClipPlayer
              clip={clip}
              src={clipPublicUrl(clip.file_path)}
              playToken={game.play_token ?? null}
              muteOverlay={
                <div className="bg-black/80 px-4 py-2 rounded-xl text-lg md:text-2xl font-black tracking-wider animate-pulse">
                  🔇 DUB THIS PART
                </div>
              }
            />
          </div>
        </Card>
      )}

      {game.state === "submitting" && (
        <Submit
          code={code}
          round={game.current_round}
          playerToken={playerToken}
          playerId={playerId}
          submissions={submissions}
        />
      )}

      {game.state === "reveal" && (
        <Card>
          <p className="text-xl font-bold mb-2">Watch the host's screen</p>
          <p className="opacity-70">Each dub is being played now. Get ready to vote.</p>
        </Card>
      )}

      {game.state === "voting" && (
        <Vote
          code={code}
          round={game.current_round}
          playerToken={playerToken}
          playerId={playerId}
          submissions={submissions}
          votes={votes}
        />
      )}

      {game.state === "scoreboard" && (
        <PlayerScoreboard players={players} myId={playerId} />
      )}

      {game.state === "finished" && (
        <Card>
          <p className="text-xl font-bold mb-2">Game over!</p>
          <p className="opacity-70 mb-4">Final scores:</p>
          <PlayerScoreboard players={players} myId={playerId} compact />
        </Card>
      )}

      <ChatPanel gameId={game.id} code={code} playerToken={playerToken} />
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen flex items-center justify-center p-4 text-center">{children}</main>;
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="rounded-2xl border border-white/10 bg-white/5 p-6">{children}</section>;
}

function Submit({ code, round, playerToken, playerId, submissions }: {
  code: string;
  round: number;
  playerToken: string;
  playerId: string;
  submissions: SubmissionRow[];
}) {
  const mine = submissions.find((s) => s.round === round && s.player_id === playerId);
  const [phrase, setPhrase] = useState(mine?.phrase ?? "");
  const [voice, setVoice] = useState<string>(mine?.voice ?? "random");
  const [recording, setRecording] = useState<RecordedVoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submitted = !!mine;

  // Sync local input to a fresh round
  useEffect(() => {
    if (mine) {
      setPhrase(mine.phrase);
      setVoice(mine.voice ?? "random");
    }
    setRecording(null);
  }, [mine?.id, round]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      let res: Response;
      if (recording) {
        const fd = new FormData();
        fd.append("player_token", playerToken);
        fd.append("phrase", phrase.trim());
        fd.append("voice", voice);
        fd.append("voice_file", recording.blob, "voice." + (recording.mimeType.includes("mp4") ? "mp4" : "webm"));
        res = await fetch(`/api/games/${code}/submit`, { method: "POST", body: fd });
      } else {
        res = await fetch(`/api/games/${code}/submit`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ player_token: playerToken, phrase: phrase.trim(), voice }),
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      track("dub_submitted", { voice, role: "player", with_recording: recording ? 1 : 0 });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <p className="text-xs uppercase tracking-widest opacity-60 mb-1">Round {round}</p>
      <p className="text-xl font-bold mb-4">Type your dub</p>
      <p className="text-sm opacity-70 mb-4">Watch the host's screen — when the audio cuts out, what do they say?</p>
      <form onSubmit={send} className="flex flex-col gap-3">
        <textarea
          value={phrase}
          onChange={(e) => setPhrase(e.target.value.slice(0, PHRASE_MAX_LEN))}
          maxLength={PHRASE_MAX_LEN}
          rows={3}
          className="rounded-xl bg-black/40 px-4 py-3 outline-none focus:ring-2 focus:ring-white/40 resize-none"
          placeholder="They're coming to get you, Barbara"
          autoFocus
        />
        <div className="flex justify-between text-xs opacity-50">
          <span>{phrase.length} / {PHRASE_MAX_LEN}</span>
          {submitted && <span>✓ submitted — you can edit until reveal</span>}
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-wider opacity-60">Voice</span>
          <VoicePicker value={voice} onChange={setVoice} disabled={busy || !!recording} />
          {recording && (
            <p className="text-xs opacity-50 italic">Voice picker is ignored when you record yourself.</p>
          )}
        </div>
        <VoiceRecorder value={recording} onChange={setRecording} disabled={busy} />
        <button
          type="submit"
          disabled={busy || (phrase.trim().length === 0 && !recording)}
          className="rounded-xl bg-white text-black font-bold py-3"
        >
          {submitted ? "Update" : "Submit"}
        </button>
      </form>
      {err && <p className="text-red-400 mt-3 text-sm">{err}</p>}
    </Card>
  );
}

function Vote({ code, round, playerToken, playerId, submissions, votes }: {
  code: string;
  round: number;
  playerToken: string;
  playerId: string;
  submissions: SubmissionRow[];
  votes: { round: number; voter_id: string; voted_for_submission_id: string }[];
}) {
  const myVote = votes.find((v) => v.round === round && v.voter_id === playerId);
  const others = useMemo(
    () => submissions.filter((s) => s.round === round && s.player_id !== playerId),
    [submissions, round, playerId],
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function vote(submissionId: string) {
    if (busyId) return;
    setBusyId(submissionId);
    setErr(null);
    try {
      const res = await fetch(`/api/games/${code}/vote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ player_token: playerToken, submission_id: submissionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusyId(null);
    }
  }

  if (others.length === 0) {
    return <Card><p>No other dubs to vote on this round.</p></Card>;
  }

  return (
    <Card>
      <p className="text-xs uppercase tracking-widest opacity-60 mb-1">Round {round}</p>
      <p className="text-xl font-bold mb-4">Pick the funniest</p>
      <ul className="flex flex-col gap-2">
        {others.map((s) => {
          const chosen = myVote?.voted_for_submission_id === s.id;
          return (
            <li key={s.id}>
              <button
                onClick={() => vote(s.id)}
                disabled={busyId !== null}
                className={`w-full text-left rounded-xl px-4 py-3 border transition ${
                  chosen ? "border-white bg-white text-black font-bold" : "border-white/10 bg-black/40 hover:bg-black/60"
                }`}
              >
                "{s.phrase}"
              </button>
            </li>
          );
        })}
      </ul>
      {myVote && <p className="text-sm opacity-60 mt-3">✓ vote locked in — wait for the host.</p>}
      {err && <p className="text-red-400 mt-3 text-sm">{err}</p>}
    </Card>
  );
}

function PlayerScoreboard({ players, myId, compact }: { players: { id: string; nickname: string; score: number }[]; myId: string; compact?: boolean }) {
  const ranked = [...players].sort((a, b) => b.score - a.score);
  return (
    <Card>
      {!compact && <p className="text-xl font-bold mb-3">Scoreboard</p>}
      <ol className="flex flex-col gap-2">
        {ranked.map((p, i) => (
          <li
            key={p.id}
            className={`flex justify-between items-center rounded-xl px-4 py-2 ${
              p.id === myId ? "bg-white text-black font-bold" : "bg-black/30"
            }`}
          >
            <span><span className="opacity-50 mr-3">{i + 1}.</span>{p.nickname}{p.id === myId ? " (you)" : ""}</span>
            <span className="font-bold">{p.score}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
