-- Add optional recorded-voice URL to submissions.
-- Voice files live in a public Storage bucket called `voices` and are deleted
-- when a game resets or finishes (server-side cleanup in the advance route).

alter table submissions
  add column if not exists voice_url text;
