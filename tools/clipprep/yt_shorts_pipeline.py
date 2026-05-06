"""YouTube Shorts ingestion pipeline.

Discovers fresh YouTube Shorts via the YouTube Data API v3 search endpoint,
fetches their auto-captions, picks a sentence-bounded mute window, and upserts
embed metadata into the Supabase `clips` table — *without* downloading or
hosting the video. Playback is via the YouTube IFrame Player API in the
client, so embedding is sanctioned by YouTube and creators get the views.

Designed to be run weekly via GitHub Actions cron (.github/workflows/yt-shorts-weekly.yml).

Required environment variables:
    YT_API_KEY              YouTube Data API v3 key
    SUPABASE_URL            https://<project>.supabase.co
    SUPABASE_SERVICE_KEY    service-role key (NOT the anon key)
    YT_PACK                 (optional) pack id, default 'yt_audits'
    YT_QUERY                (optional) search query, default 'first amendment audit'
    YT_TARGET_COUNT         (optional) how many fresh clips to add, default 25
"""

from __future__ import annotations

import json
import os
import random
import re
import sys
import urllib.parse
import urllib.request
from dataclasses import dataclass

CLIP_DURATION_S = 60.0  # max length we'll consider; Shorts are 60s max
MUTE_MIN_S = 3.0
MUTE_MAX_S = 7.0
MUTE_REGION_PAD_S = 2.0  # buffer from each end of the clip
MIN_CAPTION_COVERAGE_S = 8.0

SENTENCE_END_RE = re.compile(r"[.!?…][\")\]]?\s*$")


@dataclass
class CaptionWord:
    start: float
    end: float
    text: str


def http_get_json(url: str, headers: dict | None = None) -> dict:
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


# ---------- discovery via YouTube Data API ----------

def search_shorts(query: str, api_key: str, max_results: int = 50) -> list[dict]:
    """Search for Short-duration videos matching the query."""
    params = {
        "key": api_key,
        "part": "snippet",
        "q": query,
        "type": "video",
        "videoDuration": "short",   # < 4 min, but we'll filter to actual shorts later
        "videoEmbeddable": "true",
        "maxResults": str(max_results),
        "order": "relevance",
        "safeSearch": "none",
        "regionCode": "US",
        "relevanceLanguage": "en",
    }
    url = "https://www.googleapis.com/youtube/v3/search?" + urllib.parse.urlencode(params)
    data = http_get_json(url)
    items = data.get("items", [])
    return [
        {
            "video_id": it["id"]["videoId"],
            "title": it["snippet"]["title"],
            "channel_name": it["snippet"]["channelTitle"],
            "channel_id": it["snippet"]["channelId"],
        }
        for it in items
        if it.get("id", {}).get("videoId")
    ]


def fetch_video_details(video_ids: list[str], api_key: str) -> dict[str, dict]:
    """Get duration + status for a batch of videos."""
    if not video_ids:
        return {}
    params = {
        "key": api_key,
        "part": "contentDetails,status",
        "id": ",".join(video_ids),
    }
    url = "https://www.googleapis.com/youtube/v3/videos?" + urllib.parse.urlencode(params)
    data = http_get_json(url)
    out: dict[str, dict] = {}
    for it in data.get("items", []):
        out[it["id"]] = {
            "duration_iso": it.get("contentDetails", {}).get("duration", ""),
            "embeddable": it.get("status", {}).get("embeddable", False),
            "made_for_kids": it.get("status", {}).get("madeForKids", False),
        }
    return out


def parse_iso_duration(iso: str) -> float:
    """ISO 8601 duration like 'PT1M30S' -> seconds."""
    m = re.match(r"PT(?:(\d+)M)?(?:(\d+)S)?", iso or "")
    if not m:
        return 0.0
    minutes = int(m.group(1) or 0)
    seconds = int(m.group(2) or 0)
    return float(minutes * 60 + seconds)


# ---------- captions ----------

import subprocess
import tempfile
from pathlib import Path


def _parse_vtt_time(s: str) -> float:
    s = s.strip().split(" ")[0]
    parts = s.replace(",", ".").split(":")
    if len(parts) == 3:
        h, m, sec = parts
        return int(h) * 3600 + int(m) * 60 + float(sec)
    if len(parts) == 2:
        m, sec = parts
        return int(m) * 60 + float(sec)
    return float(parts[0])


def _parse_vtt(content: str) -> list[CaptionWord]:
    """Spread each cue's text evenly across its time range to fake word-level timestamps."""
    words: list[CaptionWord] = []
    cur_start = 0.0
    cur_end = 0.0
    cue_lines: list[str] = []

    def flush_cue():
        if cur_end <= cur_start or not cue_lines:
            return
        text = " ".join(cue_lines).strip()
        text = re.sub(r"<[^>]+>", "", text)
        text = re.sub(r"&[a-z]+;", "", text)
        toks = text.split()
        if not toks:
            return
        per = max(0.05, (cur_end - cur_start) / len(toks))
        t = cur_start
        for tok in toks:
            words.append(CaptionWord(start=t, end=t + per, text=tok))
            t += per

    for raw in content.split("\n"):
        line = raw.strip()
        if "-->" in line:
            flush_cue()
            cue_lines = []
            parts = line.split(" --> ")
            cur_start = _parse_vtt_time(parts[0])
            cur_end = _parse_vtt_time(parts[1])
        elif line == "" or line.startswith("WEBVTT") or line.startswith("NOTE") or line.isdigit():
            if line == "":
                flush_cue()
                cue_lines = []
        else:
            cue_lines.append(line)
    flush_cue()
    return words


def fetch_captions(video_id: str) -> list[CaptionWord]:
    """Fetch auto-generated captions via yt-dlp (skipping video download)."""
    with tempfile.TemporaryDirectory() as tmp:
        try:
            result = subprocess.run(
                [
                    "yt-dlp",
                    # YouTube's player requires JS execution; use Node (ubiquitous on
                    # GH runners and most dev machines).
                    "--js-runtimes", "node",
                    "--skip-download",
                    "--write-auto-sub",
                    "--sub-format", "vtt",
                    "--sub-langs", "en,en-US,en-GB",
                    "-o", f"{tmp}/%(id)s.%(ext)s",
                    "--no-playlist",
                    f"https://www.youtube.com/watch?v={video_id}",
                ],
                check=False,
                capture_output=True,
                text=True,
                timeout=45,
            )
        except subprocess.TimeoutExpired:
            print(f"  [skip] caption fetch timed out for {video_id}")
            return []

        vtt_files = list(Path(tmp).glob("*.vtt"))
        if not vtt_files:
            stderr_short = (result.stderr or "")[:200].replace("\n", " ")
            print(f"  [skip] no caption file for {video_id}: {stderr_short}")
            return []
        try:
            content = vtt_files[0].read_text(encoding="utf-8")
        except Exception:
            return []
        return _parse_vtt(content)


# ---------- mute window selection (mirrors prepare_movie.py) ----------

def _ends_sentence(text: str) -> bool:
    return bool(SENTENCE_END_RE.search(text or ""))


def caption_coverage_s(words: list[CaptionWord], start: float, end: float) -> float:
    total = 0.0
    for w in words:
        if w.end <= start or w.start >= end:
            continue
        total += min(w.end, end) - max(w.start, start)
    return total


def pick_mute_window(
    words: list[CaptionWord], duration_s: float, rng: random.Random
) -> tuple[float, float, str] | None:
    """Pick a mute span 3-7s, preferably between sentence boundaries."""
    if duration_s < (MUTE_REGION_PAD_S * 2 + MUTE_MIN_S):
        return None

    mid_start = MUTE_REGION_PAD_S
    mid_end = duration_s - MUTE_REGION_PAD_S

    if caption_coverage_s(words, mid_start, mid_end) < MIN_CAPTION_COVERAGE_S * (duration_s / 30.0):
        # not enough speech to dub over
        return None

    # Sentence-bounded candidates first
    valid_starts: list[int] = []
    for i, w in enumerate(words):
        if w.start < mid_start or w.end > mid_end:
            continue
        prev = words[i - 1] if i > 0 else None
        if prev is None or _ends_sentence(prev.text):
            valid_starts.append(i)

    valid_runs: list[tuple[int, int]] = []
    for i in valid_starts:
        for j in range(i, len(words)):
            wj = words[j]
            if wj.end > mid_end:
                break
            span = wj.end - words[i].start
            if span > MUTE_MAX_S:
                break
            if span < MUTE_MIN_S:
                continue
            if not _ends_sentence(wj.text):
                continue
            valid_runs.append((i, j))

    if not valid_runs:
        # Loose fallback: any 3-7s span in the muteable region
        for i, w in enumerate(words):
            if w.start < mid_start or w.end > mid_end:
                continue
            for j in range(i, len(words)):
                wj = words[j]
                if wj.end > mid_end:
                    break
                span = wj.end - words[i].start
                if span > MUTE_MAX_S:
                    break
                if span < MUTE_MIN_S:
                    continue
                valid_runs.append((i, j))

    if not valid_runs:
        return None

    i, j = rng.choice(valid_runs)
    run = words[i:j + 1]
    phrase = " ".join(w.text for w in run).strip()
    return run[0].start, run[-1].end, phrase


def group_subtitles(
    words: list[CaptionWord],
    duration_s: float,
    mute_start_s: float,
    mute_end_s: float,
) -> list[dict]:
    segments: list[dict] = []
    buf: list[CaptionWord] = []

    def flush():
        if not buf:
            return
        seg_start = buf[0].start
        seg_end = buf[-1].end
        if seg_start >= mute_start_s and seg_end <= mute_end_s:
            buf.clear()
            return
        text = " ".join(w.text for w in buf).strip()
        if text:
            segments.append({
                "start_ms": int(round(seg_start * 1000)),
                "end_ms": int(round(seg_end * 1000)),
                "text": text,
            })
        buf.clear()

    for w in words:
        if w.start >= mute_start_s and w.end <= mute_end_s:
            flush()
            continue
        buf.append(w)
        is_terminal = bool(SENTENCE_END_RE.search(w.text))
        long_enough = len(buf) >= 9
        too_long = (buf[-1].end - buf[0].start) >= 3.0
        if is_terminal or long_enough or too_long:
            flush()
    flush()
    return segments


# ---------- Supabase ----------

def upsert_clip(supabase_url: str, supabase_key: str, row: dict) -> None:
    body = json.dumps([row]).encode("utf-8")
    url = supabase_url.rstrip("/") + "/rest/v1/clips?on_conflict=id"
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as _resp:
        pass


def existing_youtube_ids(supabase_url: str, supabase_key: str, package: str) -> set[str]:
    url = (
        supabase_url.rstrip("/")
        + f"/rest/v1/clips?package=eq.{package}&select=youtube_id&youtube_id=not.is.null"
    )
    req = urllib.request.Request(
        url,
        headers={
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        rows = json.loads(resp.read().decode("utf-8"))
    return {r["youtube_id"] for r in rows if r.get("youtube_id")}


# ---------- main ----------

def main() -> int:
    # Force UTF-8 on stdout — Windows' default cp1252 chokes on emoji/Unicode in
    # video titles when we print progress lines.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    except Exception:
        pass

    yt_key = os.environ.get("YT_API_KEY", "").strip()
    sb_url = os.environ.get("SUPABASE_URL", "").strip()
    sb_key = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
    pack = os.environ.get("YT_PACK", "yt_audits").strip()
    query = os.environ.get("YT_QUERY", "first amendment audit").strip()
    target_count = int(os.environ.get("YT_TARGET_COUNT", "25"))

    if not yt_key or not sb_url or not sb_key:
        print(
            "ERROR: YT_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY env vars required",
            file=sys.stderr,
        )
        return 1

    print(f"[cfg] pack={pack} query={query!r} target={target_count}")

    seen_ids = existing_youtube_ids(sb_url, sb_key, pack)
    print(f"[cfg] {len(seen_ids)} videos already in pack — will skip")

    print("[search] querying YouTube Data API...")
    candidates = search_shorts(query, yt_key, max_results=50)
    print(f"[search] got {len(candidates)} candidates")

    # Filter out ones we already have
    candidates = [c for c in candidates if c["video_id"] not in seen_ids]
    print(f"[search] {len(candidates)} after dedup")

    if not candidates:
        print("[done] no fresh candidates this run")
        return 0

    # Get durations + embeddability
    detail_map = fetch_video_details([c["video_id"] for c in candidates], yt_key)

    rng = random.Random()
    added = 0
    for cand in candidates:
        if added >= target_count:
            break
        details = detail_map.get(cand["video_id"], {})
        duration_s = parse_iso_duration(details.get("duration_iso", ""))
        if duration_s <= 0 or duration_s > 65 or duration_s < 10:
            continue  # not really a Short or too tiny
        if not details.get("embeddable"):
            continue
        if details.get("made_for_kids"):
            continue  # avoid kid-coded content for player privacy

        words = fetch_captions(cand["video_id"])
        if not words:
            continue

        result = pick_mute_window(words, duration_s, rng)
        if result is None:
            print(f"  [skip] {cand['video_id']} no muteable window")
            continue
        mute_start_s, mute_end_s, phrase = result

        subtitles = group_subtitles(words, duration_s, mute_start_s, mute_end_s)

        clip_id = f"yt_{cand['video_id']}"
        row = {
            "id": clip_id,
            "file_path": f"https://www.youtube.com/watch?v={cand['video_id']}",
            "duration_ms": int(duration_s * 1000),
            "mute_start_ms": int(mute_start_s * 1000),
            "mute_end_ms": int(mute_end_s * 1000),
            "package": pack,
            "youtube_id": cand["video_id"],
            "title": cand["title"][:200],
            "channel_name": cand["channel_name"][:120],
            "channel_url": f"https://www.youtube.com/channel/{cand['channel_id']}",
            "subtitles": subtitles,
        }
        try:
            upsert_clip(sb_url, sb_key, row)
            added += 1
            print(f"  [add] {clip_id} ({duration_s:.1f}s, mute={mute_start_s:.1f}-{mute_end_s:.1f}s) — {cand['title'][:60]}")
        except Exception as e:
            print(f"  [err] failed to upsert {clip_id}: {e}")

    print(f"[done] added {added} new clips to pack {pack!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
