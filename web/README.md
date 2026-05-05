# Web app

Next.js 15 (App Router) game frontend + API. Supabase for Postgres, Realtime, and Storage. Web Speech API in the host browser for TTS.

## Setup

1. Install deps: `npm install`
2. Create a Supabase project (free tier).
3. Apply the migration in `supabase/migrations/0001_init.sql` via the SQL editor in the Supabase dashboard.
4. Copy `.env.local.example` to `.env.local` and fill in your Supabase URL + keys.
5. Run the clip prep pipeline (see `tools/clipprep/`).
6. Seed the clips. Two options:
   - **Local mode (recommended for testing):** copies clips into `web/public/clips/` and skips the Storage upload entirely.
     ```bash
     npm run seed:clips -- --local --manifest ../tools/clipprep/output/manifest.json
     ```
   - **Storage mode:** create a public Storage bucket named `clips` in the Supabase dashboard, upload the contents of `tools/clipprep/output/` to it, then:
     ```bash
     npm run seed:clips -- --manifest ../tools/clipprep/output/manifest.json
     ```
7. `npm run dev` and open <http://localhost:3000>.

## Architecture notes

- The host's browser is the only one that plays the video and speaks TTS. Players' phones only show input/vote UI.
- The mute window is applied at playback time (`video.volume = 0` between `mute_start_ms` and `mute_end_ms`); during reveal, the host pauses the video, fires TTS, then resumes after `speechSynthesis.speak` ends.
- State transitions are server-authoritative (API routes using the service-role key). Clients listen to the `games` row + child tables via Supabase Realtime postgres_changes.

## Deploy

Push to GitHub, connect Vercel, set env vars, deploy. No special config needed — websockets go through Supabase Realtime, not Vercel.
