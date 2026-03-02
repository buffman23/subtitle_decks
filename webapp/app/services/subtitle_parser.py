import re
from dataclasses import dataclass
from datetime import timedelta

import srt

_HTML_TAG_RE = re.compile(r"<[^>]+>")


def strip_html(text: str) -> str:
    return _HTML_TAG_RE.sub("", text)


def _fmt(td: timedelta) -> str:
    """Format a timedelta as 'HH:MM:SS,mmm'."""
    total_ms = int(td.total_seconds() * 1000)
    h = total_ms // 3_600_000
    total_ms %= 3_600_000
    m = total_ms // 60_000
    total_ms %= 60_000
    s = total_ms // 1000
    ms = total_ms % 1000
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


@dataclass
class SubtitleData:
    index: int
    start_time: str      # "HH:MM:SS,mmm"
    end_time: str
    start_seconds: float
    text: str            # plain text (HTML stripped)


def parse_srt(content: str | bytes) -> list[SubtitleData]:
    """
    Parse SRT content (str or bytes) and return structured SubtitleData objects.
    Tries UTF-8 first, falls back to Windows-1256.
    """
    if isinstance(content, bytes):
        try:
            content = content.decode("utf-8")
        except UnicodeDecodeError:
            content = content.decode("windows-1256", errors="replace")

    subtitles = list(srt.parse(content))
    result = []
    for sub in subtitles:
        text = strip_html(sub.content.strip())
        if not text:
            continue
        result.append(SubtitleData(
            index=sub.index,
            start_time=_fmt(sub.start),
            end_time=_fmt(sub.end),
            start_seconds=sub.start.total_seconds(),
            text=text,
        ))
    return result
