"""Clip prep pipeline.

Turns a public-domain movie into ~15-second dialogue clips plus a manifest the
game app can consume. See README.md for the full pipeline description.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterable

CLIP_DURATION_S = 15.0
MIN_SPEECH_COVERAGE_S = 8.0
MIN_MIDDLE_RUN_S = 5.5  # need a long continuous speech run we can mute (multi-speaker fallback)
MUTE_MIN_S = 5.0
MUTE_MAX_S = 7.0
# When diarization is available and the entire mute span is one speaker, we
# can relax the minimum because uniform-speaker mutes feel more natural.
SAME_SPEAKER_MUTE_MIN_S = 2.0
SAME_SPEAKER_MIN_RUN_S = 2.5
# How far in from each edge of the clip the mute window can sit. Loosened from
# the strict middle-third because a 5-7s mute won't fit in a 5s middle third.
MUTE_REGION_PAD_S = 3.0
WINDOW_STEP_S = 1.0
SCRIPT_DIR = Path(__file__).resolve().parent


@dataclass
class Word:
    start: float
    end: float
    text: str
    speaker: str | None = None  # populated by diarization when available


@dataclass
class SubtitleSegment:
    start_ms: int
    end_ms: int
    text: str


@dataclass
class ClipSpec:
    id: str
    file: str
    duration_ms: int
    mute_start_ms: int
    mute_end_ms: int
    original_phrase: str
    context_before: str
    context_after: str
    subtitles: list[SubtitleSegment]


def slugify(text: str) -> str:
    text = re.sub(r"[^a-zA-Z0-9]+", "_", text).strip("_").lower()
    return text[:40] or "movie"


def download_input(input_arg: str, cache_dir: Path) -> Path:
    """Resolve --input to a local mp4 path. Downloads with yt-dlp if it's a URL."""
    if not input_arg.startswith(("http://", "https://")):
        path = Path(input_arg).expanduser().resolve()
        if not path.is_file():
            raise FileNotFoundError(f"Input file not found: {path}")
        return path

    cache_dir.mkdir(parents=True, exist_ok=True)
    slug = slugify(input_arg.rstrip("/").rsplit("/", 1)[-1])
    target = cache_dir / f"{slug}.mp4"
    if target.exists() and target.stat().st_size > 1_000_000:
        print(f"[download] using cached {target}")
        return target

    print(f"[download] yt-dlp -> {target}")
    cmd = [
        "yt-dlp",
        "-f", "best[ext=mp4]/best",
        "--merge-output-format", "mp4",
        "-o", str(target),
        input_arg,
    ]
    subprocess.run(cmd, check=True)
    if not target.exists():
        # yt-dlp may rename based on title; pick the largest .mp4 in cache
        candidates = sorted(cache_dir.glob("*.mp4"), key=lambda p: p.stat().st_size, reverse=True)
        if not candidates:
            raise RuntimeError("yt-dlp finished but no mp4 found in cache")
        return candidates[0]
    return target


@dataclass
class SpeakerTurn:
    start: float
    end: float
    speaker: str


def diarize(media_path: Path, _unused_token: str, cache_path: Path) -> list[SpeakerTurn]:
    """Run speaker diarization via simple-diarizer (SpeechBrain ECAPA + spectral clustering).
    Caches per-movie result to JSON. No HF auth required — models come from
    SpeechBrain's public Hugging Face mirror.
    """
    if cache_path.exists():
        print(f"[diarize] using cached diarization {cache_path}")
        raw = json.loads(cache_path.read_text(encoding="utf-8"))
        return [SpeakerTurn(**t) for t in raw]

    # simple-diarizer needs a wav file; mp4 won't work directly. Extract a
    # mono 16kHz wav next to the cache for it to chew on.
    audio_wav = cache_path.with_suffix(".wav")
    if not audio_wav.exists():
        print(f"[diarize] extracting audio to {audio_wav.name}...")
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(media_path), "-ac", "1", "-ar", "16000",
             "-vn", "-loglevel", "error", str(audio_wav)],
            check=True,
        )

    print("[diarize] loading simple-diarizer (one-time SpeechBrain ECAPA download)...")
    from simple_diarizer.diarizer import Diarizer  # lazy import
    diar = Diarizer(embed_model="ecapa", cluster_method="sc")

    print(f"[diarize] running on {audio_wav.name} (this is the slow step, ~5-15 min on CPU)...")
    segments = diar.diarize(str(audio_wav), num_speakers=None)

    turns: list[SpeakerTurn] = []
    for seg in segments:
        start = float(seg.get("start", 0.0))
        end = float(seg.get("end", start))
        label = seg.get("label", 0)
        turns.append(SpeakerTurn(start=start, end=end, speaker=f"SPEAKER_{label}"))
    turns.sort(key=lambda t: t.start)
    print(f"[diarize] found {len(turns)} speaker turns from {len({t.speaker for t in turns})} distinct speakers")
    cache_path.write_text(
        json.dumps([asdict(t) for t in turns], ensure_ascii=False),
        encoding="utf-8",
    )
    return turns


def assign_speakers(words: list[Word], turns: list[SpeakerTurn]) -> None:
    """Annotate each Word in-place with the speaker active at its midpoint."""
    if not turns:
        return
    # Two-pointer walk for O(n+m).
    i = 0
    for w in words:
        midpoint = (w.start + w.end) / 2.0
        while i < len(turns) and turns[i].end < midpoint:
            i += 1
        if i < len(turns) and turns[i].start <= midpoint <= turns[i].end:
            w.speaker = turns[i].speaker


def transcribe(media_path: Path, model_name: str, cache_path: Path) -> list[Word]:
    """Run faster-whisper, return words with timestamps. Caches JSON to cache_path."""
    if cache_path.exists():
        print(f"[transcribe] using cached transcript {cache_path}")
        raw = json.loads(cache_path.read_text(encoding="utf-8"))
        return [Word(**w) for w in raw]

    from faster_whisper import WhisperModel  # imported lazily so --help is fast
    import time

    last_err: Exception | None = None
    model = None
    for attempt in range(1, 7):
        try:
            print(f"[transcribe] loading model {model_name} (attempt {attempt})...")
            model = WhisperModel(model_name, device="cpu", compute_type="int8")
            break
        except Exception as e:  # noqa: BLE001 — we want to retry on any download/network error
            last_err = e
            wait = min(2 ** attempt, 30)
            print(f"[transcribe] model load failed ({type(e).__name__}: {e}); retrying in {wait}s")
            time.sleep(wait)
    if model is None:
        raise RuntimeError(f"model download failed after retries: {last_err}")
    print(f"[transcribe] transcribing {media_path.name}...")
    segments, _info = model.transcribe(
        str(media_path),
        word_timestamps=True,
        vad_filter=True,
    )
    words: list[Word] = []
    for seg in segments:
        if not seg.words:
            continue
        for w in seg.words:
            text = (w.word or "").strip()
            if not text:
                continue
            words.append(Word(start=float(w.start), end=float(w.end), text=text))
    print(f"[transcribe] {len(words)} words extracted")
    cache_path.write_text(
        json.dumps([asdict(w) for w in words], ensure_ascii=False),
        encoding="utf-8",
    )
    return words


def speech_coverage(words: list[Word], window_start: float, window_end: float) -> float:
    """Total seconds of [window_start, window_end] covered by any word."""
    total = 0.0
    for w in words:
        if w.end <= window_start or w.start >= window_end:
            continue
        total += min(w.end, window_end) - max(w.start, window_start)
    return total


def longest_continuous_run(words: list[Word], start: float, end: float, max_gap_s: float = 0.6) -> float:
    """Longest run of speech within [start, end] tolerating gaps up to max_gap_s."""
    in_window = [w for w in words if w.start < end and w.end > start]
    if not in_window:
        return 0.0
    in_window.sort(key=lambda w: w.start)
    best = 0.0
    run_start = max(in_window[0].start, start)
    last_end = min(in_window[0].end, end)
    for w in in_window[1:]:
        ws = max(w.start, start)
        we = min(w.end, end)
        if ws - last_end <= max_gap_s:
            last_end = max(last_end, we)
        else:
            best = max(best, last_end - run_start)
            run_start = ws
            last_end = we
    best = max(best, last_end - run_start)
    return best


def find_clip_windows(words: list[Word], total_duration: float, max_clips: int | None) -> list[tuple[float, float]]:
    """Slide a 15s window, score each, greedily pick non-overlapping winners."""
    candidates: list[tuple[float, float, float]] = []  # (score, start, end)
    t = 0.0
    while t + CLIP_DURATION_S <= total_duration:
        end = t + CLIP_DURATION_S
        coverage = speech_coverage(words, t, end)
        if coverage >= MIN_SPEECH_COVERAGE_S:
            # Look for the long continuous run within the muteable region.
            mute_region_start = t + MUTE_REGION_PAD_S
            mute_region_end = end - MUTE_REGION_PAD_S
            mid_run = longest_continuous_run(words, mute_region_start, mute_region_end)
            if mid_run >= MIN_MIDDLE_RUN_S:
                # score: weight long run heavily, total coverage as tiebreak
                score = mid_run * 2.0 + coverage
                candidates.append((score, t, end))
        t += WINDOW_STEP_S

    candidates.sort(reverse=True)  # highest score first
    chosen: list[tuple[float, float]] = []
    for _score, start, end in candidates:
        if any(not (end <= cs or start >= ce) for cs, ce in chosen):
            continue
        chosen.append((start, end))
        if max_clips is not None and len(chosen) >= max_clips:
            break
    chosen.sort()  # chronological order in the manifest
    return chosen


SENTENCE_END_RE = re.compile(r'[.!?…][\")\]]?\s*$')


def _ends_sentence(text: str) -> bool:
    return bool(SENTENCE_END_RE.search(text or ""))


def pick_mute_window(
    words: list[Word],
    clip_start: float,
    clip_end: float,
    rng: random.Random,
    speaker_aware: bool = False,
) -> tuple[float, float, str] | None:
    """Pick a contiguous run of words in the muteable region for the mute span.

    Always: both ends land on a sentence boundary (previous word ended with .?!,
    last word ends with .?!).

    If `speaker_aware` is True: ALSO require all words in the span have the same
    speaker_id. Allows shorter mute spans (SAME_SPEAKER_MUTE_MIN_S) since a
    single-speaker mute feels natural at any duration.

    Returns None if no such run fits.
    """
    mid_start = clip_start + MUTE_REGION_PAD_S
    mid_end = clip_end - MUTE_REGION_PAD_S
    min_dur = SAME_SPEAKER_MUTE_MIN_S if speaker_aware else MUTE_MIN_S

    valid_starts: list[int] = []
    for i, w in enumerate(words):
        if w.start < mid_start or w.end > mid_end:
            continue
        prev = words[i - 1] if i > 0 else None
        if prev is None or _ends_sentence(prev.text):
            valid_starts.append(i)

    valid_runs: list[tuple[int, int]] = []
    for i in valid_starts:
        run_speaker = words[i].speaker if speaker_aware else None
        # If we're speaker-aware but the starting word has no speaker label, skip.
        if speaker_aware and run_speaker is None:
            continue
        for j in range(i, len(words)):
            wj = words[j]
            if wj.end > mid_end:
                break
            if speaker_aware and wj.speaker != run_speaker:
                break  # run can't extend past a speaker change
            span = wj.end - words[i].start
            if span > MUTE_MAX_S:
                break
            if span < min_dur:
                continue
            if not _ends_sentence(wj.text):
                continue
            valid_runs.append((i, j))

    if not valid_runs:
        return None

    i, j = rng.choice(valid_runs)
    run = words[i:j + 1]
    phrase = " ".join(w.text for w in run).strip()
    return run[0].start, run[-1].end, phrase


QUALITY_PRESETS = {
    # name -> (crf, scale_filter | None, audio_bitrate, audio_channels)
    "low":    ("30", "scale=-2:360",  "64k",  "1"),  # ~350-450 KB/clip
    "medium": ("26", "scale=-2:480",  "96k",  "2"),  # ~600-800 KB/clip
    "high":   ("23", None,             "128k", "2"),  # original ~900-1200 KB/clip
}


def extract_clip(source: Path, start: float, duration: float, target: Path, quality: str = "high") -> None:
    """ffmpeg cut: re-encode for an exact start position and faststart for streaming."""
    target.parent.mkdir(parents=True, exist_ok=True)
    crf, scale, abitrate, achannels = QUALITY_PRESETS[quality]
    cmd = [
        "ffmpeg", "-y",
        "-ss", f"{start:.3f}",
        "-i", str(source),
        "-t", f"{duration:.3f}",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", crf,
    ]
    if scale:
        cmd += ["-vf", scale]
    cmd += [
        "-c:a", "aac",
        "-b:a", abitrate,
        "-ac", achannels,
        "-movflags", "+faststart",
        "-loglevel", "error",
        str(target),
    ]
    subprocess.run(cmd, check=True)


def group_subtitles(
    words: list[Word],
    clip_start: float,
    clip_end: float,
    mute_start: float,
    mute_end: float,
    max_words_per_segment: int = 9,
    max_seg_duration_s: float = 3.0,
) -> list[SubtitleSegment]:
    """Group the words inside a clip into short readable subtitle segments.

    Splits on sentence-ending punctuation (.!?), or when a segment hits
    max_words_per_segment, or when it exceeds max_seg_duration_s. Words that
    fall entirely inside the mute window are excluded so the subtitle layer
    doesn't reveal the answer to the players.
    """
    in_clip = [w for w in words if w.start >= clip_start and w.end <= clip_end]
    in_clip.sort(key=lambda w: w.start)
    segments: list[SubtitleSegment] = []
    buf: list[Word] = []

    def flush():
        if not buf:
            return
        seg_start = buf[0].start
        seg_end = buf[-1].end
        # Skip segments that lie entirely inside the mute window.
        if seg_start >= mute_start and seg_end <= mute_end:
            buf.clear()
            return
        text = " ".join(w.text for w in buf).strip()
        if text:
            segments.append(SubtitleSegment(
                start_ms=int(round((seg_start - clip_start) * 1000)),
                end_ms=int(round((seg_end - clip_start) * 1000)),
                text=text,
            ))
        buf.clear()

    for w in in_clip:
        # Don't include words that fall entirely inside the muted span.
        if w.start >= mute_start and w.end <= mute_end:
            flush()
            continue
        buf.append(w)
        is_terminal = bool(SENTENCE_END_RE.search(w.text))
        long_enough = len(buf) >= max_words_per_segment
        too_long = (buf[-1].end - buf[0].start) >= max_seg_duration_s
        if is_terminal or long_enough or too_long:
            flush()
    flush()
    return segments


def context_phrase(words: list[Word], anchor_time: float, direction: str, max_words: int = 8) -> str:
    """Up to max_words of speech immediately before/after anchor_time."""
    if direction == "before":
        chunk = [w for w in words if w.end <= anchor_time]
        return " ".join(w.text for w in chunk[-max_words:]).strip()
    chunk = [w for w in words if w.start >= anchor_time]
    return " ".join(w.text for w in chunk[:max_words]).strip()


def probe_duration(media_path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(media_path)],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    return float(out)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="URL (yt-dlp) or local mp4 path")
    parser.add_argument("--output", required=True, help="output directory for clips + manifest")
    parser.add_argument("--max-clips", type=int, default=None, help="cap number of clips (debug)")
    parser.add_argument("--model", default="small.en", help="faster-whisper model (default: small.en)")
    parser.add_argument("--seed", type=int, default=42, help="RNG seed for mute window picks")
    parser.add_argument("--source-name", default=None, help="display name in manifest (default: derived from input)")
    parser.add_argument("--quality", choices=list(QUALITY_PRESETS.keys()), default="high",
                        help="output encoding preset: low (~400KB/clip, 360p mono 64k aac), "
                             "medium (~700KB/clip, 480p stereo 96k aac), high (default, ~1MB/clip, source-res)")
    parser.add_argument("--diarize", action="store_true",
                        help="run speaker diarization (pyannote) and require all-same-speaker "
                             "mute spans. Allows shorter spans (2-7s instead of 5-7s) for "
                             "more natural-feeling cuts. Requires HF_TOKEN env var.")
    args = parser.parse_args(argv)

    if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
        print("ERROR: ffmpeg/ffprobe must be on PATH", file=sys.stderr)
        return 1

    output_dir = Path(args.output).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    cache_dir = SCRIPT_DIR / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)

    media_path = download_input(args.input, cache_dir)
    duration = probe_duration(media_path)
    print(f"[probe] media duration: {duration:.1f}s")

    transcript_cache = cache_dir / f"transcript_{slugify(media_path.stem)}_{args.model}.json"
    words = transcribe(media_path, args.model, transcript_cache)
    if not words:
        print("ERROR: transcription returned no words", file=sys.stderr)
        return 1

    if args.diarize:
        diarization_cache = cache_dir / f"diarization_{slugify(media_path.stem)}.json"
        turns = diarize(media_path, "", diarization_cache)
        assign_speakers(words, turns)
        labelled = sum(1 for w in words if w.speaker is not None)
        print(f"[diarize] labelled {labelled}/{len(words)} words with speaker IDs")

    rng = random.Random(args.seed)
    windows = find_clip_windows(words, duration, args.max_clips)
    print(f"[clips] selected {len(windows)} non-overlapping dialogue windows")

    source_name = args.source_name or media_path.stem.replace("_", " ").title()
    clips: list[ClipSpec] = []
    skipped_no_sentence = 0
    next_idx = 1
    for clip_start, clip_end in windows:
        result = pick_mute_window(words, clip_start, clip_end, rng, speaker_aware=args.diarize)
        if result is None:
            skipped_no_sentence += 1
            continue
        mute_abs_start, mute_abs_end, phrase = result

        clip_id = f"{slugify(source_name)}_{next_idx:03d}"
        clip_file = f"clip_{next_idx:03d}.mp4"
        target = output_dir / clip_file
        next_idx += 1

        extract_clip(media_path, clip_start, CLIP_DURATION_S, target, quality=args.quality)

        mute_start_ms = int(round((mute_abs_start - clip_start) * 1000))
        mute_end_ms = int(round((mute_abs_end - clip_start) * 1000))
        # clamp into [0, duration]
        mute_start_ms = max(0, min(mute_start_ms, int(CLIP_DURATION_S * 1000) - 100))
        mute_end_ms = max(mute_start_ms + 100, min(mute_end_ms, int(CLIP_DURATION_S * 1000)))

        subtitles = group_subtitles(words, clip_start, clip_end, mute_abs_start, mute_abs_end)

        clips.append(ClipSpec(
            id=clip_id,
            file=clip_file,
            duration_ms=int(CLIP_DURATION_S * 1000),
            mute_start_ms=mute_start_ms,
            mute_end_ms=mute_end_ms,
            original_phrase=phrase,
            context_before=context_phrase(words, mute_abs_start, "before"),
            context_after=context_phrase(words, mute_abs_end, "after"),
            subtitles=subtitles,
        ))
        print(f"[clip] {clip_id} ({clip_start:.2f}-{clip_end:.2f})  mute={phrase!r}")

    manifest = {
        "source": source_name,
        "clip_count": len(clips),
        "clips": [asdict(c) for c in clips],
    }
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[done] wrote {manifest_path} ({len(clips)} clips, skipped {skipped_no_sentence} for no sentence-bounded mute)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
