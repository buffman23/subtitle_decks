"""
Wiktionary-derived Greek lexicon used to correct Stanza's Greek lemmas.

Stanza's Greek model (UD GDT) lemmatizes every personal pronoun as "εγώ" and
occasionally invents non-words (e.g. "εμένα" -> "εγώνος"). This lexicon maps
each inflected form to its Wiktionary headword(s) so GreekProcessor can check
Stanza's lemma against a real dictionary.

Data comes from kaikki.org's wiktextract dump of English Wiktionary's Greek
entries (CC BY-SA). It is built once into a compact gzipped TSV:

    python -m app.services.greek_lexicon build [--source URL|PATH] [--out PATH]

Rows are either  F<TAB>form<TAB>lemma<TAB>UPOS  (form -> headword)
             or  A<TAB>variant<TAB>canonical   (alternative spelling, e.g. αγαπώ -> αγαπάω).

This module must stay importable without app config (the deploy runs the
builder in a bare container).
"""
from __future__ import annotations

import argparse
import gzip
import io
import json
import os
import re
import sys
import unicodedata
import urllib.request
from pathlib import Path
from typing import Iterable, Iterator

KAIKKI_URL = "https://kaikki.org/dictionary/Greek/kaikki.org-dictionary-Greek.jsonl.gz"
LEXICON_FILENAME = "el_wiktionary_lexicon.tsv.gz"

# wiktextract part of speech -> UPOS (normalized, see _norm_upos). Affixes,
# phrases, symbols etc. are skipped — they never match a subtitle token.
_POS_MAP = {
    "noun": "NOUN",
    "name": "PROPN",
    "adj": "ADJ",
    "verb": "VERB",
    "adv": "ADV",
    "pron": "PRON",
    "num": "NUM",
    "intj": "INTJ",
    "prep": "ADP",
    "contraction": "ADP",
    "conj": "CONJ",
    "article": "DET",
    "det": "DET",
    "particle": "PART",
}

# Same letter set as GreekProcessor's tokenizer; filters out romanizations and
# inflection-template names that wiktextract mixes into "forms".
_GREEK_WORD_RE = re.compile(
    r"[ΆΈ-Ͽἀ-῿̀-ͯ]+"
    r"(?:[-'’][ΆΈ-Ͽἀ-῿̀-ͯ]+)*"
)
_SKIP_FORM_TAGS = {"romanization", "table-tags", "inflection-template", "class"}


def _norm_upos(upos: str) -> str:
    """Collapse UPOS distinctions Wiktionary doesn't make."""
    if upos == "AUX":
        return "VERB"
    if upos in ("CCONJ", "SCONJ"):
        return "CONJ"
    return upos


def lookup_key(form: str) -> str:
    """Case- and accent-insensitive key, so all-caps subtitles (no accents) still match."""
    decomposed = unicodedata.normalize("NFD", form.casefold())
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


# ---------------------------------------------------------------------------
# Runtime lookup
# ---------------------------------------------------------------------------

class GreekLexicon:
    def __init__(self, entries: dict[str, list[tuple[str, str, str]]], alts: dict[str, str]):
        # lookup_key(form) -> [(form, lemma, upos), ...]
        self._entries = entries
        # alternative spelling -> canonical headword
        self._alts = alts
        self._headwords = {lemma for rows in entries.values() for _, lemma, _ in rows}

    @classmethod
    def load(cls, path: str | Path) -> "GreekLexicon":
        entries: dict[str, list[tuple[str, str, str]]] = {}
        alts: dict[str, str] = {}
        intern = sys.intern
        with gzip.open(path, "rt", encoding="utf-8") as fh:
            for line in fh:
                parts = line.rstrip("\n").split("\t")
                if parts[0] == "F" and len(parts) == 4:
                    _, form, lemma, upos = parts
                    entries.setdefault(lookup_key(form), []).append(
                        (form, intern(lemma), intern(upos))
                    )
                elif parts[0] == "A" and len(parts) == 3:
                    alts[parts[1]] = parts[2]
        return cls(entries, alts)

    def __len__(self) -> int:
        return len(self._entries)

    def lookup(self, form: str) -> list[tuple[str, str]]:
        """Candidate (lemma, UPOS) pairs for a surface form.

        Exact (lowercased) matches win. The accent-insensitive key is only a
        fallback for unaccented tokens (all-caps subtitles drop accents), so an
        accented token never matches a differently accented word (πότε/ποτέ).
        """
        key = lookup_key(form)
        rows = self._entries.get(key)
        if not rows:
            return []
        lowered = form.lower()
        exact = [row for row in rows if row[0] == lowered]
        if not exact and key != lowered.replace("ς", "σ"):
            return []
        return [(lemma, upos) for _, lemma, upos in (exact or rows)]

    def _canon(self, lemma: str) -> str:
        return self._alts.get(lemma, lemma)

    def choose(
        self, token: str, candidates: list[tuple[str, str]], stanza_lemma: str, upos: str
    ) -> str | None:
        """Pick the dictionary lemma for a token, or None to keep Stanza's.

        1. Stanza's lemma is a valid headword for this form -> keep it.
        2. Exactly one candidate shares Stanza's POS -> use it.
        3. All candidates agree on one lemma (Stanza's POS was wrong) -> use it.
        Lemmas are compared and returned in their canonical spelling (λέγω -> λέω,
        μιλώ -> μιλάω) so spelling variants are counted together.
        """
        if not candidates:
            return None
        lemmas = {self._canon(lemma) for lemma, _ in candidates}
        if self._canon(stanza_lemma) in lemmas:
            return self._canon(stanza_lemma)
        pos_lemmas = {
            self._canon(lemma) for lemma, cand_upos in candidates if cand_upos == _norm_upos(upos)
        }
        if len(pos_lemmas) == 1:
            chosen = next(iter(pos_lemmas))
        elif len(lemmas) == 1:
            chosen = next(iter(lemmas))
        else:
            return None
        # Wiktionary lists elisions (σ, απ) as their own headwords; when the token
        # is just a truncation of Stanza's real headword (σε, από), keep Stanza's.
        if (
            chosen.lower() == token.lower()
            and stanza_lemma in self._headwords
            and lookup_key(stanza_lemma).startswith(lookup_key(token))
        ):
            return None
        return chosen


# ---------------------------------------------------------------------------
# Build from the kaikki.org dump
# ---------------------------------------------------------------------------

def _is_greek_word(text: str) -> bool:
    return bool(_GREEK_WORD_RE.fullmatch(text))


def _entry_rows(entry: dict) -> Iterator[tuple]:
    upos = _POS_MAP.get(entry.get("pos", ""))
    word = entry.get("word", "")
    if upos is None or not _is_greek_word(word):
        return
    word_lc = word.lower() if upos != "PROPN" else word

    is_headword = False
    for sense in entry.get("senses", []):
        form_of = sense.get("form_of") or []
        for target in form_of:
            lemma = target.get("word", "")
            if _is_greek_word(lemma):
                yield ("F", word.lower(), lemma, upos)
        if not form_of:
            is_headword = True
        for target in sense.get("alt_of") or []:
            canonical = target.get("word", "")
            if _is_greek_word(canonical) and canonical != word:
                yield ("A", word_lc, canonical)

    if not is_headword:
        # Pure "inflection of X" entries: their "forms" list is X's paradigm
        # table, which must not be attributed to this form.
        return
    yield ("F", word.lower(), word_lc, upos)
    for form in entry.get("forms", []):
        text = form.get("form", "")
        if _SKIP_FORM_TAGS.intersection(form.get("tags", [])):
            continue
        # Some declension tables are parsed as bare endings (αριός -> ός, ά, ό);
        # a real inflected form of a longer word is never that short.
        if len(text) <= 2 and len(word) > 3:
            continue
        if _is_greek_word(text) and text.lower() != word.lower():
            yield ("F", text.lower(), word_lc, upos)


def build_rows(lines: Iterable[str]) -> list[tuple]:
    rows: set[tuple] = set()
    for line in lines:
        line = line.strip()
        if not line:
            continue
        rows.update(_entry_rows(json.loads(line)))
    # Drop ambiguous or abbreviation-style alternatives (α -> άντε / ανατολικός):
    # a variant is only folded into its canonical spelling when that is unique.
    alt_targets: dict[str, set[str]] = {}
    for row in rows:
        if row[0] == "A":
            alt_targets.setdefault(row[1], set()).add(row[2])
    return sorted(
        row for row in rows
        if row[0] != "A" or (len(row[1]) > 1 and len(alt_targets[row[1]]) == 1)
    )


def _open_source(source: str) -> io.TextIOBase:
    if source.startswith(("http://", "https://")):
        raw = urllib.request.urlopen(source, timeout=60)
    else:
        raw = open(source, "rb")
    if source.endswith(".gz"):
        raw = gzip.GzipFile(fileobj=raw)
    return io.TextIOWrapper(raw, encoding="utf-8")


def default_lexicon_path() -> Path:
    if os.getenv("GREEK_LEXICON_PATH"):
        return Path(os.environ["GREEK_LEXICON_PATH"])
    stanza_dir = os.getenv(
        "STANZA_RESOURCES_DIR",
        str(Path(__file__).resolve().parents[3] / "stanza_resources"),
    )
    return Path(stanza_dir) / LEXICON_FILENAME


def build(source: str, out: Path) -> int:
    with _open_source(source) as fh:
        rows = build_rows(fh)
    out.parent.mkdir(parents=True, exist_ok=True)
    # Write then rename, so the file's existence means a complete build.
    tmp = out.with_name(out.name + ".tmp")
    with gzip.open(tmp, "wt", encoding="utf-8") as fh:
        for row in rows:
            fh.write("\t".join(row) + "\n")
    os.replace(tmp, out)
    return len(rows)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    build_cmd = sub.add_parser("build", help="Build the lexicon from the kaikki.org dump")
    build_cmd.add_argument("--source", default=KAIKKI_URL, help="kaikki JSONL(.gz) URL or path")
    build_cmd.add_argument("--out", type=Path, default=None, help="Output .tsv.gz path")
    args = parser.parse_args(argv)

    out = args.out or default_lexicon_path()
    count = build(args.source, out)
    print(f"Wrote {count} rows to {out}")


if __name__ == "__main__":
    main()
