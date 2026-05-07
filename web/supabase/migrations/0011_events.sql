-- Custom analytics: a single events table fed by /api/events. Cheaper than
-- relying on Vercel Analytics and lets us see exactly what's happening.

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  props jsonb not null default '{}'::jsonb,
  path text,
  referrer text,
  session_id text,
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_events_name_time on events (event_name, created_at desc);
create index if not exists idx_events_session on events (session_id);
create index if not exists idx_events_time on events (created_at desc);

-- No anon access. Reads happen via service-role through the admin page.
alter table events enable row level security;
