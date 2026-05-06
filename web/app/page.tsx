"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { track } from "@vercel/analytics";
import { isValidCode } from "@/lib/code";
import { PACK_CATALOG } from "@/lib/game-state";
import { LobbyBrowser } from "@/components/LobbyBrowser";

export default function Home() {
  return (
    <Suspense fallback={<main className="min-h-screen" />}>
      <HomeInner />
    </Suspense>
  );
}

function HomeInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [hosting, setHosting] = useState(false);
  const [hostNickname, setHostNickname] = useState("");
  const [customCode, setCustomCode] = useState("");
  const [pack, setPack] = useState<string>("notld");
  const [isPublic, setIsPublic] = useState(false);
  const [lobbyTitle, setLobbyTitle] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [nickname, setNickname] = useState("");
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nicknameInputRef = useRef<HTMLInputElement>(null);

  // Prefill from ?code=ABCDE (e.g. via QR scan from the host's lobby).
  useEffect(() => {
    const param = searchParams.get("code");
    if (param) {
      const upper = param.toUpperCase();
      setJoinCode(upper);
      // Send focus to nickname input so the phone keyboard pops open.
      setTimeout(() => nicknameInputRef.current?.focus(), 50);
    }
  }, [searchParams]);

  async function host(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!hostNickname.trim()) {
      setError("Pick a nickname");
      return;
    }
    const trimmedCustom = customCode.trim().toUpperCase();
    if (trimmedCustom && !isValidCode(trimmedCustom)) {
      setError("Custom code must be 5 chars, A–Z and 2–9 only (no I, L, O, 0, 1)");
      return;
    }
    setHosting(true);
    try {
      const res = await fetch("/api/games", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nickname: hostNickname.trim(),
          package: pack,
          is_public: isPublic,
          ...(isPublic && lobbyTitle.trim() ? { lobby_title: lobbyTitle.trim() } : {}),
          ...(trimmedCustom ? { custom_code: trimmedCustom } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create game");
      localStorage.setItem(`host_token:${data.code}`, data.host_token);
      localStorage.setItem(`player_token:${data.code}`, data.player_token);
      localStorage.setItem(`player_id:${data.code}`, data.player_id);
      localStorage.setItem(`nickname:${data.code}`, data.nickname);
      router.push(`/host/${data.code}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
      setHosting(false);
    }
  }

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const code = joinCode.trim().toUpperCase();
    if (!isValidCode(code)) {
      setError("Code must be 5 letters/numbers");
      return;
    }
    if (!nickname.trim()) {
      setError("Pick a nickname");
      return;
    }
    setJoining(true);
    try {
      const res = await fetch(`/api/games/${code}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nickname: nickname.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to join");
      track("game_joined");
      localStorage.setItem(`player_token:${code}`, data.player_token);
      localStorage.setItem(`player_id:${code}`, data.player_id);
      localStorage.setItem(`nickname:${code}`, data.nickname);
      router.push(`/play/${code}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
      setJoining(false);
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 gap-12">
      <header className="text-center space-y-3">
        <h1 className="text-5xl font-black tracking-tight">Stupid Dubbing</h1>
        <p className="text-lg opacity-70">Watch a clip. The dialogue is muted. Make it up. The funniest one wins.</p>
      </header>

      <div className="grid md:grid-cols-3 gap-6 w-full max-w-5xl">
        <section className="rounded-2xl border border-white/10 bg-white/5 p-6 flex flex-col gap-4">
          <h2 className="text-2xl font-bold">Host a game</h2>
          <p className="text-sm opacity-70">Open this on the big screen / TV / laptop with speakers. You'll play along too.</p>
          <form onSubmit={host} className="flex flex-col gap-3 mt-auto">
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wider opacity-60">Your nickname</span>
              <input
                value={hostNickname}
                onChange={(e) => setHostNickname(e.target.value)}
                maxLength={20}
                className="rounded-xl bg-black/40 px-4 py-3 outline-none focus:ring-2 focus:ring-white/40"
                placeholder="your name"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wider opacity-60">Clip pack</span>
              <select
                value={pack}
                onChange={(e) => setPack(e.target.value)}
                className="rounded-xl bg-black/40 px-4 py-3 outline-none focus:ring-2 focus:ring-white/40 appearance-none"
              >
                {PACK_CATALOG.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
              <span className="text-xs opacity-50">
                {PACK_CATALOG.find((p) => p.id === pack)?.description}
              </span>
            </label>
            <label className="flex items-start gap-3 cursor-pointer rounded-xl bg-black/40 px-4 py-3 hover:bg-black/50 transition">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
                className="mt-1 accent-white"
              />
              <span className="flex-1">
                <span className="block text-sm font-bold">🌐 Public lobby</span>
                <span className="block text-xs opacity-60 mt-0.5">Show this game in the lobby browser so strangers can join</span>
              </span>
            </label>
            {isPublic && (
              <label className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wider opacity-60">
                  Lobby title <span className="opacity-60 normal-case">(optional)</span>
                </span>
                <input
                  value={lobbyTitle}
                  onChange={(e) => setLobbyTitle(e.target.value.slice(0, 60))}
                  maxLength={60}
                  className="rounded-xl bg-black/40 px-4 py-3 outline-none focus:ring-2 focus:ring-white/40"
                  placeholder="Friday night vibes"
                />
              </label>
            )}
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wider opacity-60">
                Custom code <span className="opacity-60 normal-case">(optional)</span>
              </span>
              <input
                value={customCode}
                onChange={(e) => setCustomCode(e.target.value.toUpperCase().slice(0, 5))}
                maxLength={5}
                inputMode="text"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                className="rounded-xl bg-black/40 px-4 py-3 font-mono tracking-widest uppercase outline-none focus:ring-2 focus:ring-white/40"
                placeholder="leave blank for random"
              />
              <span className="text-xs opacity-50">5 chars · A–Z and 2–9 only · no I, L, O, 0, 1</span>
            </label>
            <button
              type="submit"
              disabled={hosting}
              className="w-full rounded-xl bg-white text-black font-bold py-3 hover:bg-white/90"
            >
              {hosting ? "Starting…" : "Host"}
            </button>
          </form>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/5 p-6 flex flex-col gap-4">
          <h2 className="text-2xl font-bold">Solo</h2>
          <p className="text-sm opacity-70">Just want to dub some clips? No friends, no signup, no scoring — just you and a bunch of muted videos.</p>
          <a
            href="/solo"
            className="mt-auto block text-center w-full rounded-xl bg-white/15 hover:bg-white/25 font-bold py-3"
          >
            🎯 Play solo
          </a>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/5 p-6 flex flex-col gap-4">
          <h2 className="text-2xl font-bold">Join a game</h2>
          <form onSubmit={join} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wider opacity-60">Game code</span>
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                maxLength={5}
                inputMode="text"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                className="rounded-xl bg-black/40 px-4 py-3 text-2xl font-mono tracking-[0.3em] uppercase text-center outline-none focus:ring-2 focus:ring-white/40"
                placeholder="ABCDE"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wider opacity-60">Nickname</span>
              <input
                ref={nicknameInputRef}
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                maxLength={20}
                className="rounded-xl bg-black/40 px-4 py-3 outline-none focus:ring-2 focus:ring-white/40"
                placeholder="your name"
              />
            </label>
            <button
              type="submit"
              disabled={joining}
              className="rounded-xl bg-white text-black font-bold py-3 hover:bg-white/90"
            >
              {joining ? "Joining…" : "Join"}
            </button>
          </form>
        </section>
      </div>

      {error && <p className="text-red-400 max-w-md text-center">{error}</p>}

      <LobbyBrowser />
    </main>
  );
}
