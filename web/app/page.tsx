"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { isValidCode } from "@/lib/code";

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
    setHosting(true);
    try {
      const res = await fetch("/api/games", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nickname: hostNickname.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create game");
      sessionStorage.setItem(`host_token:${data.code}`, data.host_token);
      sessionStorage.setItem(`player_token:${data.code}`, data.player_token);
      sessionStorage.setItem(`player_id:${data.code}`, data.player_id);
      sessionStorage.setItem(`nickname:${data.code}`, data.nickname);
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
      sessionStorage.setItem(`player_token:${code}`, data.player_token);
      sessionStorage.setItem(`player_id:${code}`, data.player_id);
      sessionStorage.setItem(`nickname:${code}`, data.nickname);
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

      <div className="grid md:grid-cols-2 gap-8 w-full max-w-3xl">
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
    </main>
  );
}
