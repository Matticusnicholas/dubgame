-- CRITICAL: previous migrations left `for select using (true)` on games and
-- players, AND the anon role had column-level access to every column —
-- including `host_token` and `player_token`. Anyone who knew a 5-letter game
-- code could call select * and obtain the tokens, taking over the game.
--
-- Fix: revoke broad column access from anon/authenticated and re-grant only
-- the columns we want clients to see. RLS row policies stay (they already
-- gate which rows are visible). Service role bypasses GRANTs so server API
-- routes are unaffected.

-- games — exclude host_token
revoke all on games from anon, authenticated;
grant select (
  id, code, state, current_round, total_rounds,
  current_clip_id, played_clip_ids, package,
  is_public, lobby_title,
  play_token, current_reveal_submission_id,
  created_at
) on games to anon, authenticated;

-- players — exclude player_token and last_msg_at (the latter is chat-rate-
-- limit metadata, not interesting to clients)
revoke all on players from anon, authenticated;
grant select (
  id, game_id, nickname, score, joined_at
) on players to anon, authenticated;

-- submissions stay fully readable for now (clients render dubs during voting/
-- reveal). voice_url is now a 24h signed URL after migration 0009 + the
-- submit route change, so leakage is bounded. We'll tighten this later.
-- votes, messages, clips: no sensitive columns.
