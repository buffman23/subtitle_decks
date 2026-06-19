"""Japanese lemmatizer backed by fugashi (MeCab) + full UniDic.

Japanese has no spaces, so segmentation and lemmatization happen together in a
single morphological pass — the whitespace/regex `StanzaProcessor` base is unusable
here. The lemma is UniDic's lexeme (語彙素), which collapses inflections *and*
orthographic variants (e.g. すごい/凄い → 凄い, 食べ/食べた → 食べる) — ideal for a
frequency-study list. We keep every morpheme (the product decision), dropping only
punctuation/symbols/whitespace.

Dictionary location: if the env var ``UNIDIC_DIR`` is set we point MeCab at it
(mirrors ``CAMELTOOLS_DATA`` / ``STANZA_RESOURCES_DIR`` and lets the deploy mount
the ~770MB dict from a persistent volume); otherwise fugashi auto-resolves the
pip-installed ``unidic`` package. On any failure we degrade to raw tokens.

Statefulness note: ``frequency_analyzer.analyze`` calls ``tokenize`` once per
subtitle (in order) and then ``lemmatize`` once. Because MeCab yields surface +
lemma in one parse but ``lemmatize`` never sees the original text, ``tokenize``
buffers each token's lemma and ``lemmatize`` drains that buffer. The job queue runs
exactly one analysis at a time (single worker under ``model_lock``), so the buffer
is never shared concurrently; a fresh "collection window" is started on the first
``tokenize`` after a drain, so a job that errors mid-analysis cannot desync the next.
"""

import logging
import os
import re
from typing import Any, Callable, ClassVar

from app.services.language_processor import (
    CancelledAnalysis,
    LanguageProcessor,
    LemmaResult,
    LemmatizationUnavailable,
)

logger = logging.getLogger(__name__)

# POS1 classes to exclude from the frequency list (punctuation/symbols/whitespace).
# Everything else — including particles (助詞) and auxiliaries (助動詞) — is kept.
_DROP_POS1 = {"補助記号", "記号", "空白"}

_EMPTY_VALUES = {None, "", "*"}

# Fallback tokenizer if MeCab/UniDic can't load: keep runs of Japanese script
# (hiragana, katakana, kanji, prolonged-sound mark) and standalone alnum words.
_FALLBACK_RE = re.compile(r"[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]+|[0-9A-Za-z]+")


def _clean_analysis(analysis: dict[str, Any]) -> dict:
    return {key: value for key, value in analysis.items() if value not in _EMPTY_VALUES}


def _clean_lemma(lemma: str) -> str:
    """Strip UniDic's homograph/origin annotation suffix (私-代名詞, ラーメン-Rahmen).

    UniDic separates the annotation with an ASCII hyphen; the katakana long-vowel
    mark (ー, U+30FC) is a different character, so splitting on '-' is safe.
    """
    return lemma.split("-", 1)[0] if lemma else lemma


class JapaneseProcessor(LanguageProcessor):
    # None = unloaded, False = load failed, Tagger = loaded (mirrors StanzaProcessor).
    _tagger: ClassVar[object] = None

    def __init__(self) -> None:
        # Per-job buffer of (lemma, analysis) in token order, filled by tokenize()
        # and drained by lemmatize(). _consumed marks that the next tokenize starts
        # a fresh collection window.
        self._pending: list[tuple[str, dict | None]] = []
        self._consumed: bool = True

    @property
    def language_code(self) -> str:
        return "ja"

    @property
    def language_name(self) -> str:
        return "Japanese (JA)"

    # --- model lifecycle ----------------------------------------------------

    @classmethod
    def preload_tagger(cls):
        if cls._tagger is not None:
            return
        try:
            import fugashi

            unidic_dir = os.getenv("UNIDIC_DIR")
            if unidic_dir:
                # MeCab parses '-d' itself and treats backslashes as escapes, so
                # normalize to forward slashes (works on Windows and Linux alike).
                cls._tagger = fugashi.Tagger("-d " + unidic_dir.replace("\\", "/"))
                logger.info("fugashi/UniDic tagger loaded from UNIDIC_DIR=%s", unidic_dir)
            else:
                cls._tagger = fugashi.Tagger()
                logger.info("fugashi/UniDic tagger loaded from installed unidic package")
        except Exception as exc:
            logger.warning("Could not load fugashi/UniDic: %s", exc)
            cls._tagger = False

    def _get_tagger(self):
        if self.__class__._tagger is None:
            self._load_measured(self.__class__.preload_tagger)
        tagger = self.__class__._tagger
        return tagger if tagger else None

    def is_loaded(self) -> bool:
        return bool(self.__class__._tagger)

    def load(self) -> None:
        self._load_measured(self.__class__.preload_tagger)

    def unload(self) -> None:
        self.__class__._tagger = None
        import gc
        gc.collect()
        logger.info("fugashi/UniDic tagger unloaded")

    # --- pipeline -----------------------------------------------------------

    def tokenize(self, text: str) -> list[str]:
        # Start a fresh collection window on the first tokenize after a drain.
        if self._consumed:
            self._pending = []
            self._consumed = False

        tagger = self._get_tagger()
        if tagger is None:
            # Model unavailable: fail loudly rather than silently lemmatizing to raw
            # tokens. Reset the buffer so this aborted job can't desync the next one.
            self._pending = []
            self._consumed = True
            raise LemmatizationUnavailable(
                f"The {self.language_name} language model (fugashi/UniDic) could not be "
                f"loaded, so the text cannot be lemmatized. Please try again later or "
                f"contact an admin."
            )

        try:
            surfaces: list[str] = []
            for word in tagger(text):
                feature = word.feature
                if feature.pos1 in _DROP_POS1:
                    continue
                surface = word.surface
                if not surface.strip():
                    continue
                lemma = _clean_lemma(feature.lemma) or surface
                analysis = _clean_analysis({
                    "lex": lemma,
                    "pos": feature.pos1,
                    "reading": feature.kanaBase or feature.kana,
                    "orth_base": feature.orthBase,
                })
                surfaces.append(surface)
                self._pending.append((lemma, analysis or None))
            return surfaces
        except Exception as exc:
            # Never let a parse error escape — it would skip lemmatize() and leave
            # the buffer dirty for the next job. Degrade this subtitle to raw tokens.
            logger.debug("Japanese tokenize failed (%r): %s; using raw tokens", text, exc)
            return self._fallback_tokenize(text)

    def _fallback_tokenize(self, text: str) -> list[str]:
        tokens = _FALLBACK_RE.findall(text)
        self._pending.extend((tok, None) for tok in tokens)
        return tokens

    def lemmatize(
        self,
        token_sentences: list[list[str]],
        should_cancel: Callable[[], bool] | None = None,
    ) -> list[LemmaResult]:
        # Drain and reset the collection window first, so a cancellation (or any
        # later return) can't leave a stale buffer to desync the next job.
        pending = self._pending
        self._pending = []
        self._consumed = True

        if should_cancel is not None and should_cancel():
            raise CancelledAnalysis()

        total = sum(len(sentence) for sentence in token_sentences)
        if len(pending) == total:
            return [LemmaResult(lemma, analysis) for lemma, analysis in pending]

        # Buffer desynced from the tokens (shouldn't happen under the single-worker
        # invariant). Treat it as a real bug and fail loudly instead of silently
        # returning raw surface forms as lemmas.
        logger.error(
            "Japanese lemma buffer desync (%d buffered vs %d tokens)", len(pending), total
        )
        raise LemmatizationUnavailable(
            f"{self.language_name} lemmatization failed while processing the subtitles."
        )
