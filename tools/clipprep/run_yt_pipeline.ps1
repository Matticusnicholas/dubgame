# Local runner for the YouTube Shorts pipeline. Designed to be triggered by
# Windows Task Scheduler on a weekly cron from your home machine — residential
# IPs aren't blocked by YouTube's bot detection the way GitHub runners are.
#
# Setup once:
#   1. Set the four env vars below in your user environment OR in a .env file
#      next to this script (see ../web/.env.local for SUPABASE_URL / SERVICE key)
#   2. Open Task Scheduler → Create Basic Task → weekly → command:
#        powershell -NoProfile -ExecutionPolicy Bypass -File <full path to this script>
#   3. Run once manually to verify it works.

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# Prefer env vars; fall back to a sibling .yt.env file (key=value lines).
$envFile = Join-Path $root ".yt.env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
            $i = $line.IndexOf("=")
            $k = $line.Substring(0, $i).Trim()
            $v = $line.Substring($i + 1).Trim().Trim('"')
            [System.Environment]::SetEnvironmentVariable($k, $v, "Process")
        }
    }
}

if (-not $env:YT_API_KEY) { Write-Error "YT_API_KEY not set"; exit 1 }
if (-not $env:SUPABASE_URL) { Write-Error "SUPABASE_URL not set"; exit 1 }
if (-not $env:SUPABASE_SERVICE_KEY) { Write-Error "SUPABASE_SERVICE_KEY not set"; exit 1 }

# Make sure deps exist (idempotent). Pin yt-dlp on each run so we always have
# the latest YouTube extractor patches.
python -m pip install --quiet --upgrade yt-dlp

Set-Location $root
python yt_shorts_pipeline.py
exit $LASTEXITCODE
