import logging
import os
import re
from typing import Any, Callable

from app.services.language_processor import CancelledAnalysis, LanguageProcessor, LemmaResult

logger = logging.getLogger(__name__)

_TAGALOG_WORD_RE = re.compile(r"[A-Za-zÑñ]+(?:[-'][A-Za-zÑñ]+)*")
_EMPTY_VALUES = {None, ""}
_DEFAULT_MODEL = "tl_calamancy_md-0.2.0"


def _clean_analysis(analysis: dict[str, Any]) -> dict:
    return {key: value for key, value in analysis.items() if value not in _EMPTY_VALUES}


class TagalogProcessor(LanguageProcessor):
    _pipeline = None

    @property
    def language_code(self) -> str:
        return "tl"

    @property
    def language_name(self) -> str:
        return "Tagalog (TL)"

    def tokenize(self, text: str) -> list[str]:
        return [match.group(0) for match in _TAGALOG_WORD_RE.finditer(text)]

    @classmethod
    def preload_pipeline(cls):
        if cls._pipeline is not None:
            return
        try:
            import calamancy

            model_name = os.getenv("CALAMANCY_MODEL", _DEFAULT_MODEL)
            cls._pipeline = calamancy.load(model_name)
            logger.info("Calamancy Tagalog pipeline loaded: %s", model_name)
        except Exception as exc:
            logger.warning("Could not load Calamancy Tagalog pipeline: %s; falling back to raw tokens", exc)
            cls._pipeline = False

    def _get_pipeline(self):
        if self.__class__._pipeline is None:
            self._load_measured(self.__class__.preload_pipeline)
        return self.__class__._pipeline

    def is_loaded(self) -> bool:
        return bool(self.__class__._pipeline)

    def load(self) -> None:
        self._load_measured(self.__class__.preload_pipeline)

    def unload(self) -> None:
        self.__class__._pipeline = None
        import gc
        gc.collect()
        logger.info("Calamancy Tagalog pipeline unloaded")

    def lemmatize(
        self,
        token_sentences: list[list[str]],
        should_cancel: Callable[[], bool] | None = None,
    ) -> list[LemmaResult]:
        if should_cancel is not None and should_cancel():
            raise CancelledAnalysis()
        pipeline = self._get_pipeline()
        if not pipeline:
            return [LemmaResult(tok.lower()) for sentence in token_sentences for tok in sentence]

        try:
            from spacy.tokens import Doc

            results: list[LemmaResult] = []
            for tokens in token_sentences:
                if not tokens:
                    continue
                doc = Doc(pipeline.vocab, words=tokens)
                for _, proc in pipeline.pipeline:
                    proc(doc)
                for word in doc:
                    lemma = (word.lemma_ or word.text).lower()
                    analysis = _clean_analysis({
                        "lex": lemma,
                        "pos": word.pos_,
                        "feats": str(word.morph) or None,
                    })
                    results.append(LemmaResult(lemma, analysis or None))
            return results
        except Exception as exc:
            logger.debug("Tagalog lemmatization failed: %s", exc)
            return [LemmaResult(tok.lower()) for sentence in token_sentences for tok in sentence]
