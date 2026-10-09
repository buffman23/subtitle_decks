"""
English definitions for lemmas, from the English Wiktionary REST API.

    GET https://en.wiktionary.org/api/rest_v1/page/definition/{word}

returns definitions keyed by Wiktionary language code and grouped by part of
speech, which is exactly the shape the definition card shows. Lookups are
cached in the DB (DefinitionCache), including "no entry" results, so each
lemma hits Wiktionary at most once per _CACHE_TTL.
"""
from __future__ import annotations

import html
import re
from datetime import datetime, timedelta
from urllib.parse import quote

import httpx
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import DefinitionCache

_API_URL = "https://en.wiktionary.org/api/rest_v1/page/definition/{}"
# Wikimedia's API policy asks for a descriptive User-Agent.
_USER_AGENT = "SubtitleDecks/1.0 (subtitle word-frequency lists for language study) python-httpx"
# Common short words ("a", "de", "ir") have huge multi-language pages.
_TIMEOUT = httpx.Timeout(15.0, connect=5.0)
_CACHE_TTL = timedelta(days=30)

# Processor language_code -> Wiktionary language keys, merged in this order.
WIKTIONARY_LANGS: dict[str, list[str]] = {
    "el": ["el"],
    "de": ["de"],
    "es": ["es"],
    "en": ["en"],
    "tl": ["tl"],
    "ja": ["ja"],
    "ar-msa": ["ar"],
    "ar-egy": ["arz", "ar"],
}

# Harakat, shadda, sukun, dagger alif, tatweel: camel_tools lemmas are
# diacritized but Wiktionary page titles are not.
_ARABIC_MARKS_RE = re.compile(r"[ً-ْٰـ]")
_MERGE_CAPITALIZED = {"de"}
# Wiktionary headings that never describe a subtitle word (ISO codes etc.).
_SKIP_POS = {"Symbol", "Letter"}
_TAG_RE = re.compile(r"<[^>]+>")
_SPACE_RE = re.compile(r"\s+")


class DictionaryUnavailable(Exception):
    """Wiktionary could not be reached or returned an error."""


def is_supported(language_code: str) -> bool:
    return language_code in WIKTIONARY_LANGS


def lookup_key(language_code: str, lemma: str) -> str:
    """The Wiktionary page title to look a lemma up under."""
    lemma = lemma.strip()
    if language_code.startswith("ar-"):
        lemma = _ARABIC_MARKS_RE.sub("", lemma.split("_", 1)[0])
    return lemma


def _plain(definition_html: str) -> str:
    return _SPACE_RE.sub(" ", html.unescape(_TAG_RE.sub("", definition_html))).strip()


def _fetch(word: str) -> dict | None:
    """Raw API response for a page, or None when the page doesn't exist."""
    try:
        response = httpx.get(
            _API_URL.format(quote(word, safe="")),
            headers={"User-Agent": _USER_AGENT, "Accept": "application/json"},
            timeout=_TIMEOUT,
            follow_redirects=True,
        )
    except httpx.HTTPError as exc:
        raise DictionaryUnavailable(str(exc)) from exc
    if response.status_code == 404:
        return None
    if response.status_code != 200:
        raise DictionaryUnavailable(f"Wiktionary returned HTTP {response.status_code}")
    return response.json()


def _extract(pages: list[dict | None], wikt_langs: list[str]) -> list[dict]:
    """[{pos, definitions}] for our languages, merging repeated POS headings."""
    entries: list[dict] = []
    by_pos: dict[str, dict] = {}
    for data in pages:
        for lang in wikt_langs:
            for section in (data or {}).get(lang, []):
                pos = section.get("partOfSpeech") or "Other"
                if pos in _SKIP_POS:
                    continue
                definitions = [
                    text for d in section.get("definitions", [])
                    if (text := _plain(d.get("definition", "")))
                ]
                if not definitions:
                    continue
                entry = by_pos.get(pos)
                if entry is None:
                    entry = by_pos[pos] = {"pos": pos, "definitions": []}
                    entries.append(entry)
                entry["definitions"].extend(d for d in definitions if d not in entry["definitions"])
    return entries


def _lookup_wiktionary(language_code: str, key: str) -> list[dict]:
    wikt_langs = WIKTIONARY_LANGS[language_code]
    page = _fetch(key)
    entries = _extract([page], wikt_langs)
    # Stanza lowercases lemmas, but Wiktionary titles are case-sensitive. German
    # nouns are always capitalized and "haus" is a separate (verb-form) page, so
    # German merges both spellings; elsewhere the capitalized page is a fallback.
    capitalized = key[:1].upper() + key[1:]
    if capitalized != key and (not entries or language_code in _MERGE_CAPITALIZED):
        entries = _extract([_fetch(capitalized), page], wikt_langs)
    return entries


def lookup(db: Session, language_code: str, lemma: str) -> list[dict]:
    """POS-grouped English definitions for a lemma ([] when there is no entry).

    Raises DictionaryUnavailable on network/HTTP errors (those aren't cached).
    """
    key = lookup_key(language_code, lemma)
    if not key:
        return []
    row = db.query(DefinitionCache).filter_by(language_code=language_code, lemma=key).one_or_none()
    if row is not None and datetime.utcnow() - row.fetched_at < _CACHE_TTL:
        return row.entries

    entries = _lookup_wiktionary(language_code, key)
    if row is None:
        row = DefinitionCache(language_code=language_code, lemma=key)
        db.add(row)
    row.entries = entries
    row.fetched_at = datetime.utcnow()
    try:
        db.commit()
    except IntegrityError:
        db.rollback()  # a concurrent request cached the same lemma first
    return entries
