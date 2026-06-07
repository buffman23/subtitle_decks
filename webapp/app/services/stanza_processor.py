import logging
import os
import re
from pathlib import Path
from typing import Any, ClassVar, Pattern

from app.services.language_processor import LanguageProcessor, LemmaResult

logger = logging.getLogger(__name__)

_EMPTY_VALUES = {None, ""}
_DEFAULT_STANZA_DIR = Path(__file__).resolve().parents[3] / "stanza_resources"


def _clean_analysis(analysis: dict[str, Any]) -> dict:
    return {key: value for key, value in analysis.items() if value not in _EMPTY_VALUES}


class StanzaProcessor(LanguageProcessor):
    """
    Shared base for Stanza-backed processors. Subclasses set:
      _lang     — Stanza language code (e.g. "en")
      _word_re  — compiled word-matching regex
    and the language_code / language_name properties.
    """

    _pipeline: ClassVar[object] = None  # None = unloaded, False = load failed, object = loaded
    _lang: ClassVar[str] = ""
    _word_re: ClassVar[Pattern[str]] = re.compile(r"\S+")

    def tokenize(self, text: str) -> list[str]:
        return [match.group(0) for match in self._word_re.finditer(text)]

    @classmethod
    def preload_pipeline(cls):
        if cls._pipeline is not None:
            return
        try:
            import stanza

            cls._pipeline = stanza.Pipeline(
                cls._lang,
                processors="tokenize,pos,lemma",
                tokenize_pretokenized=True,
                dir=os.getenv("STANZA_RESOURCES_DIR", str(_DEFAULT_STANZA_DIR)),
                download_method=stanza.DownloadMethod.REUSE_RESOURCES,
                verbose=False,
            )
            logger.info("Stanza %s lemmatization pipeline loaded", cls._lang)
        except Exception as exc:
            logger.warning("Could not load Stanza %s pipeline: %s; falling back to raw tokens", cls._lang, exc)
            cls._pipeline = False

    def _get_pipeline(self):
        if self.__class__._pipeline is None:
            self.__class__.preload_pipeline()
        return self.__class__._pipeline

    def is_loaded(self) -> bool:
        return bool(self.__class__._pipeline)

    def load(self) -> None:
        self.__class__.preload_pipeline()

    def unload(self) -> None:
        self.__class__._pipeline = None
        import gc
        gc.collect()
        logger.info("Stanza %s pipeline unloaded", self.__class__._lang)

    def lemmatize(self, token_sentences: list[list[str]]) -> list[LemmaResult]:
        pipeline = self._get_pipeline()
        if not pipeline:
            return [LemmaResult(tok.lower()) for sentence in token_sentences for tok in sentence]

        try:
            doc = pipeline(token_sentences)
        except Exception as exc:
            logger.debug("Stanza %s lemmatization failed: %s", self.__class__._lang, exc)
            return [LemmaResult(tok.lower()) for sentence in token_sentences for tok in sentence]

        results: list[LemmaResult] = []
        for sentence in doc.sentences:
            for word in sentence.words:
                lemma = (word.lemma or word.text).lower()
                analysis = _clean_analysis({
                    "lex": lemma,
                    "pos": word.upos,
                    "xpos": word.xpos,
                    "feats": word.feats,
                })
                results.append(LemmaResult(lemma, analysis or None))
        return results
