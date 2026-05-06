-- Public lobby + chat infra.
-- Run this in the Supabase SQL editor.

-- Public games show up in the lobby browser on the home page.
alter table games
  add column if not exists is_public boolean not null default false,
  add column if not exists lobby_title text;

create index if not exists idx_games_public_lobby
  on games (is_public, state, created_at)
  where is_public = true and state = 'lobby';

-- Chat messages, scoped per game. Player_id null = system message.
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  player_id uuid references players(id) on delete set null,
  nickname text,
  content text not null check (length(content) <= 280),
  created_at timestamptz not null default now()
);
create index if not exists idx_messages_game_time on messages (game_id, created_at);

-- Realtime: surface message changes to clients.
alter publication supabase_realtime add table messages;

-- Per-(game, voter) rate limit on chat: a separate column on players, more
-- robust than relying on app-layer state. Counter resets when game ends.
alter table players
  add column if not exists last_msg_at timestamptz;

-- RLS: read-only access for anon clients (writes go through service-role API).
alter table messages enable row level security;
create policy "anon read messages" on messages for select using (true);
