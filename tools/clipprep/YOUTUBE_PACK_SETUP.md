# YouTube Shorts pack — setup

The weekly cron ingests fresh YouTube Shorts into the `clips` table without
downloading any video. Embedding is sanctioned by YouTube — creators get the
views, no copyright concern.

> ⚠️ **Cron host gotcha:** YouTube heavily rate-limits datacenter IPs (especially
> GitHub Actions runners). Captions return "Sign in to confirm you're not a bot."
> The recommended setup is **local cron via Windows Task Scheduler** (residential
> IP works fine). The GitHub Actions workflow stays as a fallback for when YouTube
> ever loosens up. See "Local cron" below.

## One-time setup

### 1. Get a YouTube Data API v3 key (free)

1. Go to <https://console.cloud.google.com>, sign in.
2. Create a project (any name) or pick an existing one.
3. APIs & Services → **Library** → search **YouTube Data API v3** → **Enable**.
4. APIs & Services → **Credentials** → **+ Create Credentials** → **API key**.
5. Copy the key.

Free quota: 10,000 units/day. Each weekly run uses ~150 units. Plenty.

### 2. Get your Supabase service-role key

Supabase dashboard → Settings → API → copy the `service_role` (`sb_secret_...`).

### 3. Add as GitHub secrets

GitHub repo → Settings → Secrets and variables → Actions → **New repository secret**.
Add three:

| Name | Value |
|---|---|
| `YT_API_KEY` | the YouTube Data API key |
| `SUPABASE_URL` | `https://<project-id>.supabase.co` |
| `SUPABASE_SERVICE_KEY` | the `sb_secret_...` service-role key |

### 4. Run the migration first time

In Supabase SQL editor, run `web/supabase/migrations/0005_packs.sql`:

```sql
alter table clips
  add column if not exists package text not null default 'notld',
  add column if not exists youtube_id text,
  add column if not exists title text,
  add column if not exists channel_name text,
  add column if not exists channel_url text;
create index if not exists idx_clips_package on clips (package);
alter table games
  add column if not exists package text not null default 'notld';
```

### 5. Trigger the first run manually

GitHub repo → Actions tab → **Weekly YouTube Shorts ingestion** → **Run workflow**.

You can change the query or count via the workflow inputs. After ~1–2 minutes,
~25 new clips with `package = 'yt_audits'` will appear in your Supabase clips table.

## Schedule

Runs automatically every **Sunday at 06:00 UTC** (~01:00 US Eastern). Skips
videos already in the table, so each week genuinely adds fresh content.

## Customizing the search

Edit the `cron` line in the workflow, or trigger manually with a different
`query` input. Examples that produce dub-friendly content:

- `first amendment audit`
- `karen security guard`
- `customer service nightmare`
- `airport karen`
- `roadside argument`

## Cost

Total: $0/month. YouTube Data API quota is generous, GitHub Actions is free for
public repos / 2000 free min/month for private. Each run finishes in ~2 min.

---

## Local cron (recommended — residential IP works)

GitHub Actions runners get blocked by YouTube; running the same script from your
laptop works because YouTube doesn't block home/ISP IPs.

### One-time setup

1. Copy `tools/clipprep/.yt.env.example` to `tools/clipprep/.yt.env` and fill in
   your YouTube API key + Supabase URL + service-role key. (`.yt.env` is gitignored.)
2. Open **Task Scheduler** → **Create Basic Task**.
3. Trigger: **Weekly**, pick a time you'll usually be at the laptop (e.g. Sundays 10 PM).
4. Action: **Start a program**.
5. Program/script: `powershell.exe`
6. Arguments:
   ```
   -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Test\Documents\apps\mattsdubbingstupidprogram\tools\clipprep\run_yt_pipeline.ps1"
   ```
7. Finish. Then right-click the task → **Run** to test it manually.

The script auto-installs the latest yt-dlp on each run (so YouTube extractor patches
roll in automatically) and writes new clips into Supabase. No git commits, no
Vercel deploy needed — clips appear in the database the moment the script finishes.

### Manually run anytime

```powershell
cd C:\Users\Test\Documents\apps\mattsdubbingstupidprogram\tools\clipprep
powershell -NoProfile -ExecutionPolicy Bypass -File .\run_yt_pipeline.ps1
```

Or directly:
```powershell
$env:YT_API_KEY = "..."; $env:SUPABASE_URL = "..."; $env:SUPABASE_SERVICE_KEY = "..."
python tools\clipprep\yt_shorts_pipeline.py
```
