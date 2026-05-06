-- Packs system: clips belong to a "package" (e.g. 'notld' for public-domain
-- Night of the Living Dead, 'yt_audits' for embedded YouTube First-Amendment
-- audit clips). Embedded clips reference a YouTube video_id instead of a
-- self-hosted file.

alter table clips
  add column if not exists package text not null default 'notld',
  add column if not exists youtube_id text,
  add column if not exists title text,
  add column if not exists channel_name text,
  add column if not exists channel_url text;

create index if not exists idx_clips_package on clips (package);

-- Each game can be scoped to one pack — host picks at game-create time.
alter table games
  add column if not exists package text not null default 'notld';
