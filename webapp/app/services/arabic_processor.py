import re
import logging

from app.services.language_processor import LanguageProcessor

logger = logging.getLogger(__name__)

_ARABIC_RE = re.compile(r"[\u0621-\u064A\u064B-\u065F\u0671-\u06D3\u06D5]+")


class ArabicProcessor(LanguageProcessor):
    """Abstract base for Arabic dialect processors. Subclasses set _model_name."""

    # Shared cache across all Arabic subclasses: model_name → MLEDisambiguator | None
    _disambiguators: dict[str, object] = {}
    _model_name: str = ""

    @classmethod
    def preload_disambiguator(cls):
        model = cls._model_name
        if not model or model in cls._disambiguators:
            return
        try:
            from camel_tools.disambig.mle import MLEDisambiguator
            cls._disambiguators[model] = MLEDisambiguator.pretrained(model)
            logger.info("MLEDisambiguator loaded: %s", model)
        except Exception as exc:
            logger.warning(
                "Could not load MLEDisambiguator (%s): %s — falling back to raw tokens.", model, exc
            )
            cls._disambiguators[model] = None

    def _get_disambiguator(self):
        if self._model_name not in self.__class__._disambiguators:
            self.__class__.preload_disambiguator()
        return self.__class__._disambiguators.get(self._model_name)

    def tokenize(self, text: str) -> list[str]:
        try:
            from camel_tools.tokenizers.word import simple_word_tokenize
            tokens = simple_word_tokenize(text)
        except Exception:
            tokens = text.split()
        return [tok for tok in tokens if _ARABIC_RE.fullmatch(tok)]

    def lemmatize(self, token_sentences: list[list[str]]) -> list[str]:
        lemmas: list[str] = []
        disambiguator = self._get_disambiguator()
        for sentence in token_sentences:
            if not sentence:
                continue
            if disambiguator is None:
                lemmas.extend(sentence)
                continue
            try:
                disambiguations = disambiguator.disambiguate(sentence)
                for token, disambig in zip(sentence, disambiguations):
                    analyses = disambig.analyses
                    if analyses:
                        lex = analyses[0].analysis.get("lex", token)
                        lemmas.append(lex if lex else token)
                    else:
                        lemmas.append(token)
            except Exception as exc:
                logger.debug("Disambiguation failed for sentence %s: %s", sentence, exc)
                lemmas.extend(sentence)
        return lemmas


class ArabicMSAProcessor(ArabicProcessor):
    _model_name = "calima-msa-r13"

    @property
    def language_code(self) -> str:
        return "ar-msa"

    @property
    def language_name(self) -> str:
        return "Arabic – Modern Standard (MSA)"


class ArabicEGYProcessor(ArabicProcessor):
    _model_name = "calima-egy-r13"

    @property
    def language_code(self) -> str:
        return "ar-egy"

    @property
    def language_name(self) -> str:
        return "Arabic – Egyptian (EGY)"


def preload_all():
    ArabicMSAProcessor.preload_disambiguator()
    ArabicEGYProcessor.preload_disambiguator()
