-- Add voice variant column to submissions.
-- Run this in the Supabase SQL editor.

alter table submissions
  add column if not exists voice text not null default 'random';
