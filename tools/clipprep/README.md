# Clip prep pipeline

Offline tool that turns a public-domain movie into a folder of ~15-second dialogue clips plus a manifest the game app can consume.

## Pipeline

1. **Download** the source mp4 with `yt-dlp` (handles Internet Archive URLs natively). Cached under `cache/`.
2. **Transcribe** with `faster-whisper`, getting word-level timestamps. Transcript JSON cached so re-runs are instant.
3. **Find dialogue-dense 15s windows.** Slide a 15s window across the transcript; keep windows where ≥ 6s contain speech, with a continuous run of ≥ 4s in the middle third.
4. **Pick a mute window** for each clip — a contiguous run of words from the middle third with total duration between 1.0s and 3.0s (random pick among valid runs).
5. **Cut clips** with `ffmpeg` (`-c:v libx264 -c:a aac -movflags +faststart`).
6. **Write `manifest.json`** with each clip's id, file path, duration, mute window timestamps, and original phrase (kept for debugging only — not sent to game clients).

## Setup

```bash
pip install -r requirements.txt
# Also requires `ffmpeg` on PATH.
```

## Run

```bash
python prepare_movie.py \
  --input "https://archive.org/details/night_of_the_living_dead" \
  --output ./output

# or local file
python prepare_movie.py --input ./local-movie.mp4 --output ./output

# Limit for testing
python prepare_movie.py --input ... --output ./output --max-clips 5
```

Default Whisper model is `small.en` (CPU-friendly, ~10–20 min for a 90-min film). Override with `--model medium.en` for better accuracy at 2–3× the cost.

## Output

```
output/
├── manifest.json
├── clip_001.mp4
├── clip_002.mp4
└── ...
```

Upload the contents of `output/` to a Supabase Storage bucket named `clips`, then run `npm run seed:clips` from `web/` to populate the database.
