"""
Curated lemma overrides for Egyptian Arabic.

The EGY disambiguator (calima-egy-r13 + BERT) handles most colloquial words, but
a handful of very frequent ones fall back to MSA lookalikes or backoff:
إيه -> أَيّ "which", عشان -> شَأْن (parsed as على+شأن), علشان -> unanalyzed,
والله -> إِلّا, كده/كدا split into two lemmas, etc. Because these words are so
common they distort the top of every frequency list.

Each entry here was checked against what the disambiguator actually returns —
only add words it gets wrong. Lemmas use calima's diacritized spelling so they
merge with the forms calima already lemmatizes correctly.
"""
from __future__ import annotations

import re

from camel_tools.utils.dediac import dediac_ar
from camel_tools.utils.normalize import normalize_alef_ar, normalize_alef_maksura_ar

# Object pronoun suffixes for the prepositional words below (عشانك, ازيكو ...).
_SUFFIXES = ("", "ك", "كي", "ه", "ها", "ي", "نا", "كم", "كو", "كوا", "هم")

# lemma -> (English gloss, surface spellings calima gets wrong)
_BASE: dict[str, tuple[str, tuple[str, ...]]] = {
    "إِيه":    ("what", ("إيه",)),
    "آه":      ("yes;ah", ("آه",)),
    "كِدَه":   ("like this;so;this way", ("كده", "كدا", "كدة")),
    "مِفَيِّش": ("there isn't;there's no", ("مافيش",)),
    "يَلّا":   ("come on;let's go", ("يالا",)),
    "أَيوَة":  ("yes", ("أيوا", "ايوا", "ايوة")),
    "إِمْتَى": ("when", ("إمته",)),
    "لِ":      ("to;for", ("ليا",)),
    "اَهُو":   ("here it is;there", ("أهو",)),
    "اللَّه":  ("God", ("والله",)),
}
# Same, but each spelling also takes the object pronoun suffixes above.
_WITH_SUFFIXES: dict[str, tuple[str, tuple[str, ...]]] = {
    "عَشان":  ("because;for;so that", ("عشان", "علشان")),
    "اِزَّيّ": ("how (are you)", ("إزي",)),
}


def normalize_key(token: str) -> str:
    """Spelling-insensitive key: unify alef forms and final ى/ي, drop diacritics.

    ة/ه is deliberately *not* unified (آية "verse" would collide with ايه "what");
    list both spellings explicitly instead.
    """
    return normalize_alef_maksura_ar(normalize_alef_ar(dediac_ar(token.replace("ـ", ""))))


# calima writes shadda before the short vowel (ـَّ as U+0651 U+064E); hand-typed
# lemmas may have either order, and a mismatch would split the counts.
_VOWEL_SHADDA_RE = re.compile("([\u064B-\u0650\u0652])\u0651")


def _calima_order(lemma: str) -> str:
    return _VOWEL_SHADDA_RE.sub("\u0651\\1", lemma)


def _build() -> dict[str, tuple[str, str]]:
    table: dict[str, tuple[str, str]] = {}
    for entries, suffixes in ((_BASE, ("",)), (_WITH_SUFFIXES, _SUFFIXES)):
        for lemma, (gloss, forms) in entries.items():
            for form in forms:
                for suffix in suffixes:
                    table[normalize_key(form + suffix)] = (_calima_order(lemma), gloss)
    return table


_OVERRIDES = _build()

# Single-letter proclitics tried when the full token isn't in the table
# (وإيه, فعشان, بإيه); only used if the remainder is itself an entry. Two-letter
# remainders are excluded so real words like فاه "mouth" don't become آه.
_PROCLITICS = ("و", "ف", "ب")


def lookup(token: str) -> tuple[str, str] | None:
    """(lemma, gloss) override for a token, or None to keep calima's analysis."""
    key = normalize_key(token)
    if key in _OVERRIDES:
        return _OVERRIDES[key]
    if len(key) > 3 and key[0] in _PROCLITICS:
        return _OVERRIDES.get(key[1:])
    return None
