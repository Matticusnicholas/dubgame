-- Add subtitle segments per clip (sentence-grouped words with relative timestamps).
-- Run this in the Supabase SQL editor.

alter table clips
  add column if not exists subtitles jsonb not null default '[]'::jsonb;
