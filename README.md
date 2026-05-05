# Matt's Dubbing Stupid Program

A web-based party game in the style of *What The Dub*. The host's screen plays a short video clip with a span of dialogue muted out. Anonymous players join from their phones using a 5-letter code, type a replacement phrase, and the host's browser speaks each submission via TTS during the muted window. Players vote for the funniest. Funny dub wins the round.

## Repo layout

- `tools/clipprep/` — offline Python pipeline. Downloads a public-domain movie, transcribes it with Whisper, extracts ~15s dialogue clips, picks a random mid-clip mute window, and writes a manifest.
- `web/` — Next.js 15 game app deployed to Vercel. Uses Supabase for Postgres + Realtime + Storage. Web Speech API for TTS in the host browser.

## Quickstart

```bash
# 1. Generate clips from Night of the Living Dead
cd tools/clipprep
pip install -r requirements.txt
python prepare_movie.py --input "https://archive.org/details/night_of_the_living_dead" --output ./output

# 2. Set up Supabase project, run migrations, upload clips/, seed
cd ../../web
npm install
cp .env.local.example .env.local   # fill in Supabase URLs/keys
npm run seed:clips

# 3. Run the game
npm run dev
# Open http://localhost:3000 in two browsers, host + join
```

See [`web/README.md`](./web/README.md) and [`tools/clipprep/README.md`](./tools/clipprep/README.md) for component-specific details.
