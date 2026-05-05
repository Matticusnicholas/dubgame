-- Initial schema for Matt's Dubbing Stupid Program.
-- Run this in the Supabase SQL editor for a fresh project.

-- Reset (idempotent for repeated runs in dev)
drop table if exists votes cascade;
drop table if exists submissions cascade;
drop table if exists players cascade;
drop table if exists games cascade;
drop table if exists clips cascade;

create table clips (
  id text primary key,
  file_path text not null,
  duration_ms int not null,
  mute_start_ms int not null,
  mute_end_ms int not null
);

create table games (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  host_token text not null,
  state text not null default 'lobby',
  current_round int not null default 0,
  total_rounds int not null default 5,
  current_clip_id text references clips(id),
  played_clip_ids text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index games_code_idx on games (code);

create table players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  player_token text not null,
  nickname text not null,
  score int not null default 0,
  joined_at timestamptz not null default now(),
  unique (game_id, player_token)
);

create index players_game_idx on players (game_id);

create table submissions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  round int not null,
  player_id uuid not null references players(id) on delete cascade,
  phrase text not null,
  unique (game_id, round, player_id)
);

create index submissions_game_round_idx on submissions (game_id, round);

create table votes (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  round int not null,
  voter_id uuid not null references players(id) on delete cascade,
  voted_for_submission_id uuid not null references submissions(id) on delete cascade,
  unique (game_id, round, voter_id)
);

create index votes_game_round_idx on votes (game_id, round);

-- Realtime publication: enable change broadcasting on all game-related tables
alter publication supabase_realtime add table games;
alter publication supabase_realtime add table players;
alter publication supabase_realtime add table submissions;
alter publication supabase_realtime add table votes;

-- RLS: keep simple for v1 — all writes go through server routes using service-role key.
-- Anon key is read-only on the public game-state tables.
alter table clips enable row level security;
alter table games enable row level security;
alter table players enable row level security;
alter table submissions enable row level security;
alter table votes enable row level security;

create policy "anon read clips" on clips for select using (true);
create policy "anon read games" on games for select using (true);
create policy "anon read players" on players for select using (true);
create policy "anon read submissions" on submissions for select using (true);
create policy "anon read votes" on votes for select using (true);
