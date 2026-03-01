import re
import srt

_HTML_TAG_RE = re.compile(r"<[^>]+>")


def strip_html(text: str) -> str:
    return _HTML_TAG_RE.sub("", text)


def parse_srt(content: str | bytes) -> list[str]:
    """
    Parse SRT content (str or bytes) and return a list of plain-text subtitle strings.
    Tries UTF-8 first, falls back to Windows-1256.
    """
    if isinstance(content, bytes):
        try:
            content = content.decode("utf-8")
        except UnicodeDecodeError:
            content = content.decode("windows-1256", errors="replace")

    subtitles = list(srt.parse(content))
    return [strip_html(sub.content.strip()) for sub in subtitles if sub.content.strip()]
