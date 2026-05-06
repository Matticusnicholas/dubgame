-- play_token broadcasts a "host pressed play right now" signal to every client
-- via Realtime. Updated by /api/games/[code]/play; consumed by all browsers'
-- ClipPlayer playToken prop.

alter table games
  add column if not exists play_token text;
