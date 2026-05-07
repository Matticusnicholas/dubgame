import { redirect } from "next/navigation";
import { getAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface AdminPageProps {
  searchParams: Promise<{ key?: string; window?: string }>;
}

const WINDOWS: Record<string, { label: string; ms: number }> = {
  "1h":  { label: "Last hour",   ms: 60 * 60 * 1000 },
  "24h": { label: "Last 24h",    ms: 24 * 60 * 60 * 1000 },
  "7d":  { label: "Last 7 days", ms: 7 * 24 * 60 * 60 * 1000 },
  "30d": { label: "Last 30 days", ms: 30 * 24 * 60 * 60 * 1000 },
  "all": { label: "All time",     ms: 0 },
};

interface EventRow {
  event_name: string;
  props: Record<string, unknown>;
  path: string | null;
  referrer: string | null;
  session_id: string | null;
  user_agent: string | null;
  created_at: string;
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const params = await searchParams;
  const required = process.env.ADMIN_KEY;

  // No key configured = page disabled entirely (don't expose anything).
  if (!required) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 text-center">
        <div>
          <p className="text-2xl font-bold mb-2">Admin disabled</p>
          <p className="opacity-60 text-sm">Set <code className="bg-white/10 px-1.5 py-0.5 rounded">ADMIN_KEY</code> in env to enable.</p>
        </div>
      </main>
    );
  }
  if (params.key !== required) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <form className="rounded-2xl border border-white/10 bg-white/5 p-6 flex flex-col gap-3 w-full max-w-sm">
          <p className="text-xl font-bold">Admin</p>
          <p className="text-sm opacity-70">Enter the admin key to view analytics.</p>
          <input
            name="key"
            type="password"
            placeholder="key"
            className="rounded-xl bg-black/40 px-4 py-3 outline-none focus:ring-2 focus:ring-white/40"
            autoFocus
          />
          <button type="submit" className="rounded-xl bg-white text-black font-bold py-2.5">
            View dashboard
          </button>
        </form>
      </main>
    );
  }

  const windowKey = (params.window && WINDOWS[params.window]) ? params.window : "24h";
  const w = WINDOWS[windowKey];
  const since = w.ms > 0 ? new Date(Date.now() - w.ms).toISOString() : null;

  const sb = getAdminClient();

  let q = sb.from("events").select("event_name, props, path, referrer, session_id, user_agent, created_at").order("created_at", { ascending: false });
  if (since) q = q.gte("created_at", since);
  const { data: rawEvents, error } = await q.limit(2000);
  if (error) {
    return (
      <main className="min-h-screen p-6">
        <p className="text-red-400">Error: {error.message}</p>
      </main>
    );
  }
  const events = (rawEvents ?? []) as EventRow[];

  // Aggregations
  const totalEvents = events.length;
  const uniqueSessions = new Set(events.map((e) => e.session_id).filter(Boolean)).size;

  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.event_name, (counts.get(e.event_name) ?? 0) + 1);
  const topEvents = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  const pathCounts = new Map<string, number>();
  for (const e of events.filter((x) => x.event_name === "page_view")) {
    const p = e.path || "(unknown)";
    pathCounts.set(p, (pathCounts.get(p) ?? 0) + 1);
  }
  const topPaths = [...pathCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);

  const referrerCounts = new Map<string, number>();
  for (const e of events.filter((x) => x.event_name === "page_view")) {
    let r = e.referrer || "(direct)";
    try {
      r = r === "(direct)" ? r : new URL(r).hostname;
    } catch { /* keep raw */ }
    referrerCounts.set(r, (referrerCounts.get(r) ?? 0) + 1);
  }
  const topReferrers = [...referrerCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);

  const recent = events.slice(0, 50);

  return (
    <main className="min-h-screen p-6 md:p-8 max-w-6xl mx-auto flex flex-col gap-6">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-3xl font-black tracking-tight">📊 dubgame analytics</h1>
        <nav className="flex gap-2">
          {Object.entries(WINDOWS).map(([k, v]) => (
            <a
              key={k}
              href={`?key=${encodeURIComponent(params.key!)}&window=${k}`}
              className={`text-xs uppercase tracking-wider rounded-full border px-3 py-1.5 ${
                k === windowKey ? "border-white bg-white text-black font-bold" : "border-white/20 hover:bg-white/10"
              }`}
            >
              {v.label}
            </a>
          ))}
        </nav>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Total events" value={totalEvents.toLocaleString()} />
        <Stat label="Unique sessions" value={uniqueSessions.toLocaleString()} />
        <Stat label="Page views" value={(counts.get("page_view") ?? 0).toLocaleString()} />
        <Stat label="Games hosted" value={(counts.get("game_hosted") ?? 0).toLocaleString()} />
      </section>

      <section className="grid md:grid-cols-2 gap-6">
        <Panel title="Events by name">
          <Bars rows={topEvents} />
        </Panel>
        <Panel title="Top paths (page views)">
          <Bars rows={topPaths} maxBarLen={40} />
        </Panel>
      </section>

      <section className="grid md:grid-cols-2 gap-6">
        <Panel title="Top referrers">
          <Bars rows={topReferrers} maxBarLen={32} />
        </Panel>
        <Panel title="Funnel (this window)">
          <Funnel
            stages={[
              { label: "page_view", count: counts.get("page_view") ?? 0 },
              { label: "game_hosted", count: counts.get("game_hosted") ?? 0 },
              { label: "game_started", count: counts.get("game_started") ?? 0 },
              { label: "dub_submitted", count: counts.get("dub_submitted") ?? 0 },
              { label: "game_finished", count: counts.get("game_finished") ?? 0 },
            ]}
          />
        </Panel>
      </section>

      <Panel title={`Recent events (latest 50 of ${totalEvents})`}>
        <div className="overflow-x-auto -mx-3">
          <table className="w-full text-xs">
            <thead className="text-left opacity-60">
              <tr>
                <th className="px-3 py-1.5 font-normal">when</th>
                <th className="px-3 py-1.5 font-normal">event</th>
                <th className="px-3 py-1.5 font-normal">path</th>
                <th className="px-3 py-1.5 font-normal">props</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((e, i) => (
                <tr key={i} className="border-t border-white/5">
                  <td className="px-3 py-1.5 whitespace-nowrap opacity-70 font-mono">{shortTime(e.created_at)}</td>
                  <td className="px-3 py-1.5 font-bold">{e.event_name}</td>
                  <td className="px-3 py-1.5 opacity-70 font-mono">{e.path || ""}</td>
                  <td className="px-3 py-1.5 opacity-70 font-mono">{Object.keys(e.props ?? {}).length > 0 ? JSON.stringify(e.props) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <p className="text-xs uppercase tracking-widest opacity-60">{label}</p>
      <p className="text-3xl font-black tabular-nums mt-1">{value}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <h2 className="text-sm font-bold uppercase tracking-widest opacity-70 mb-3">{title}</h2>
      {children}
    </section>
  );
}

function Bars({ rows, maxBarLen = 28 }: { rows: [string, number][]; maxBarLen?: number }) {
  if (rows.length === 0) return <p className="text-xs opacity-50 italic">No data.</p>;
  const max = Math.max(...rows.map(([, n]) => n)) || 1;
  return (
    <ul className="space-y-1.5">
      {rows.map(([name, n]) => (
        <li key={name} className="flex items-center gap-2 text-sm">
          <span className="font-mono whitespace-nowrap truncate" style={{ maxWidth: 240 }}>{name}</span>
          <span className="flex-1 bg-white/10 rounded-full h-2 overflow-hidden">
            <span className="block h-full bg-white" style={{ width: `${(n / max) * 100}%` }} />
          </span>
          <span className="font-mono tabular-nums opacity-80 w-12 text-right">{n}</span>
        </li>
      ))}
    </ul>
  );
}

function Funnel({ stages }: { stages: { label: string; count: number }[] }) {
  if (stages.length === 0) return null;
  const top = stages[0].count || 1;
  return (
    <ul className="space-y-1.5">
      {stages.map((s) => {
        const pct = (s.count / top) * 100;
        return (
          <li key={s.label} className="flex items-center gap-2 text-sm">
            <span className="font-mono whitespace-nowrap w-32">{s.label}</span>
            <span className="flex-1 bg-white/10 rounded-full h-3 overflow-hidden">
              <span className="block h-full bg-emerald-400/80" style={{ width: `${pct}%` }} />
            </span>
            <span className="font-mono tabular-nums opacity-80 w-12 text-right">{s.count}</span>
          </li>
        );
      })}
    </ul>
  );
}

function shortTime(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diffSec = Math.floor((now - d.getTime()) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return d.toLocaleString();
}
