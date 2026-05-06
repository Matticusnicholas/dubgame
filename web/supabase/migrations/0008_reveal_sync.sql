-- Sync reveal-phase state across all clients: which submission's dub is
-- currently playing. Updated by /api/games/[code]/reveal-next; consumed by
-- every browser to play the same TTS at the same time.

alter table games
  add column if not exists current_reveal_submission_id uuid references submissions(id) on delete set null;
