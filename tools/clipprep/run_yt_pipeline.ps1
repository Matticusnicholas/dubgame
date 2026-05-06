# Local runner for the YouTube Shorts pipeline. Loops over every pack defined
# in packs.json (shared API/Supabase creds come from .yt.env). Designed to be
# triggered weekly by Windows Task Scheduler — residential IPs aren't blocked
# by YouTube's bot detection the way GitHub runners are.
#
# Setup:
#   1. Fill in tools/clipprep/.yt.env with YT_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
#   2. Edit tools/clipprep/packs.json to add/remove packs
#   3. (Already done) Task Scheduler entry calls this script weekly

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# Load shared creds from .yt.env (key=value lines).
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

# Always run the latest yt-dlp so YouTube extractor patches roll in.
python -m pip install --quiet --upgrade yt-dlp

Set-Location $root

# Load packs.json — each entry triggers one pipeline run.
$packsFile = Join-Path $root "packs.json"
if (-not (Test-Path $packsFile)) {
    Write-Error "packs.json not found at $packsFile"
    exit 1
}
$packs = Get-Content $packsFile -Raw | ConvertFrom-Json
if (-not $packs) {
    Write-Error "packs.json is empty"
    exit 1
}

$exitCode = 0
foreach ($p in $packs) {
    Write-Host "==== Pack: $($p.pack) (query='$($p.query)', target=$($p.target_count)) ===="
    $env:YT_PACK = $p.pack
    $env:YT_QUERY = $p.query
    $env:YT_TARGET_COUNT = "$($p.target_count)"
    python yt_shorts_pipeline.py
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "pipeline failed for pack $($p.pack) (exit $LASTEXITCODE)"
        $exitCode = $LASTEXITCODE
    }
}
exit $exitCode
