import logging
import os
import re
from pathlib import Path
from typing import Any

from app.services.language_processor import LanguageProcessor, LemmaResult

logger = logging.getLogger(__name__)

_GERMAN_WORD_RE = re.compile(r"[A-Za-zÄÖÜäöüß]+(?:[-'][A-Za-zÄÖÜäöüß]+)*")
_EMPTY_VALUES = {None, ""}
_DEFAULT_STANZA_DIR = Path(__file__).resolve().parents[3] / "stanza_resources"


def _clean_analysis(analysis: dict[str, Any]) -> dict:
    return {key: value for key, value in analysis.items() if value not in _EMPTY_VALUES}


class GermanProcessor(LanguageProcessor):
    _pipeline = None

    @property
    def language_code(self) -> str:
        return "de"

    @property
    def language_name(self) -> str:
        return "German (DE)"

    def tokenize(self, text: str) -> list[str]:
        return [match.group(0) for match in _GERMAN_WORD_RE.finditer(text)]

    @classmethod
    def preload_pipeline(cls):
        if cls._pipeline is not None:
            return
        try:
            import stanza

            cls._pipeline = stanza.Pipeline(
                "de",
                processors="tokenize,pos,lemma",
                tokenize_pretokenized=True,
                dir=os.getenv("STANZA_RESOURCES_DIR", str(_DEFAULT_STANZA_DIR)),
                download_method=stanza.DownloadMethod.REUSE_RESOURCES,
                verbose=False,
            )
            logger.info("Stanza German lemmatization pipeline loaded")
        except Exception as exc:
            logger.warning("Could not load Stanza German pipeline: %s; falling back to raw tokens", exc)
            cls._pipeline = False

    def _get_pipeline(self):
        if self.__class__._pipeline is None:
            self.__class__.preload_pipeline()
        return self.__class__._pipeline

    def lemmatize(self, token_sentences: list[list[str]]) -> list[LemmaResult]:
        pipeline = self._get_pipeline()
        if not pipeline:
            return [LemmaResult(tok.lower()) for sentence in token_sentences for tok in sentence]

        try:
            doc = pipeline(token_sentences)
        except Exception as exc:
            logger.debug("German lemmatization failed: %s", exc)
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
