import re
import logging

from typing import Callable

from app.services import egyptian_lexicon
from app.services.language_processor import (
    CancelledAnalysis,
    LanguageProcessor,
    LemmaResult,
    LemmatizationUnavailable,
)

logger = logging.getLogger(__name__)

_ARABIC_RE = re.compile(r"[\u0621-\u064A\u064B-\u065F\u0671-\u06D3\u06D5]+")

_LEXICAL_FIELDS = ["lex", "root", "gloss", "diac", "bw", "caphi", "pattern"]
_MORPH_FIELDS   = ["pos", "per", "gen", "num", "asp", "mod", "vox", "stt", "cas", "form_gen", "form_num"]
_CLITIC_FIELDS  = ["prc0", "prc1", "prc2", "prc3", "enc0", "enc1", "enc2"]
_EMPTY_VALUES: set = {"na", None, "", -99.0}


def _extract_analysis(ana: dict) -> dict:
    return {k: ana.get(k) for k in _LEXICAL_FIELDS + _MORPH_FIELDS + _CLITIC_FIELDS
            if ana.get(k) not in _EMPTY_VALUES}


_CHUNK_TOKENS   = 200  # total window size fed to BERT
_CONTEXT_TOKENS = 50   # context padding on each side
_BATCH_TOKENS   = _CHUNK_TOKENS - 2 * _CONTEXT_TOKENS  # 100, max payload per call


class ArabicProcessor(LanguageProcessor):
    """Abstract base for Arabic dialect processors. Subclasses set _model_name."""

    # Shared cache across all Arabic subclasses: model_name → BERTUnfactoredDisambiguator | None
    _disambiguators: dict[str, object] = {}
    _model_name: str = ""

    @classmethod
    def preload_disambiguator(cls):
        model = cls._model_name
        if not model or model in cls._disambiguators:
            return
        try:
            from camel_tools.disambig.bert import BERTUnfactoredDisambiguator
            try:
                import torch
                use_gpu = torch.cuda.is_available()
            except Exception:
                use_gpu = False
            cls._disambiguators[model] = BERTUnfactoredDisambiguator.pretrained(model, use_gpu=use_gpu)
            logger.info("BERTUnfactoredDisambiguator loaded: %s (gpu=%s)", model, use_gpu)
        except Exception as exc:
            logger.warning(
                "Could not load BERTUnfactoredDisambiguator (%s): %s", model, exc
            )
            cls._disambiguators[model] = None

    def _get_disambiguator(self):
        if self._model_name not in self.__class__._disambiguators:
            self._load_measured(self.__class__.preload_disambiguator)
        return self.__class__._disambiguators.get(self._model_name)

    def is_loaded(self) -> bool:
        return self.__class__._disambiguators.get(self._model_name) is not None

    @staticmethod
    def _rescue_backoff(disambiguator, token: str) -> "LemmaResult | None":
        """Recover a real lemma for a token the disambiguator scored as backoff.

        The BERT disambiguator sometimes ranks a proper-noun *backoff* guess above
        a genuine analysis the morphological analyzer produced (common for rare
        fully-cliticized colloquial forms, e.g. قررتولي = قرّر + 2pl + IO clitic).
        When that happens we'd otherwise keep the raw surface form as its own
        lemma. Here we consult the same analyzer the disambiguator uses and, if it
        offers any non-backoff analysis, pick the most probable one so the token
        still collapses onto its true lemma. Returns None when the analyzer has no
        real analysis (a genuinely unknown word), leaving backoff handling as-is.
        """
        analyzer = getattr(disambiguator, "_analyzer", None)
        if analyzer is None:
            return None
        try:
            analyses = analyzer.analyze(token)
        except Exception:
            return None
        candidates = [a for a in analyses if a.get("source") != "backoff"]
        if not candidates:
            return None
        best = max(candidates, key=lambda a: a.get("pos_lex_logprob", -99.0))
        return LemmaResult(best.get("lex") or token, _extract_analysis(best))

    def load(self) -> None:
        self._load_measured(self.__class__.preload_disambiguator)

    def unload(self) -> None:
        self.__class__._disambiguators.pop(self._model_name, None)
        import gc
        gc.collect()
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass
        logger.info("BERTUnfactoredDisambiguator unloaded: %s", self._model_name)

    def tokenize(self, text: str) -> list[str]:
        try:
            from camel_tools.tokenizers.word import simple_word_tokenize
            tokens = simple_word_tokenize(text)
        except Exception:
            tokens = text.split()
        return [tok for tok in tokens if _ARABIC_RE.fullmatch(tok)]

    def lemmatize(
        self,
        token_sentences: list[list[str]],
        should_cancel: Callable[[], bool] | None = None,
    ) -> list[LemmaResult]:
        disambiguator = self._get_disambiguator()
        if disambiguator is None:
            raise LemmatizationUnavailable(
                f"The {self.language_name} language model could not be loaded, so the "
                f"text cannot be lemmatized. Please try again later or contact an admin."
            )

        # Build flat token list + per-subtitle index ranges
        flat_tokens: list[str] = []
        ranges: list[tuple[int, int]] = []
        for sentence in token_sentences:
            start = len(flat_tokens)
            flat_tokens.extend(sentence)
            ranges.append((start, len(flat_tokens)))

        if not flat_tokens:
            return []

        total = len(flat_tokens)

        # Group subtitles into batches (each batch's payload ≤ _BATCH_TOKENS)
        batches: list[list[int]] = []
        current_batch: list[int] = []
        current_count = 0
        for idx, (s, e) in enumerate(ranges):
            sub_len = e - s
            if sub_len == 0:
                continue
            if current_batch and current_count + sub_len > _BATCH_TOKENS:
                batches.append(current_batch)
                current_batch = []
                current_count = 0
            current_batch.append(idx)
            current_count += sub_len
        if current_batch:
            batches.append(current_batch)

        lemmas_map: dict[int, list[LemmaResult]] = {}
        backoff_count = 0

        for batch in batches:
            if should_cancel is not None and should_cancel():
                raise CancelledAnalysis()
            batch_start = ranges[batch[0]][0]
            batch_end   = ranges[batch[-1]][1]
            window_start = max(0, batch_start - _CONTEXT_TOKENS)
            window_end   = min(total, batch_end + _CONTEXT_TOKENS)
            window = flat_tokens[window_start:window_end]
            offset = batch_start - window_start
            try:
                disambiguations = disambiguator.disambiguate(window)
                for sub_idx in batch:
                    s, e = ranges[sub_idx]
                    local_start = offset + (s - batch_start)
                    sub_lemmas: list[LemmaResult] = []
                    for i in range(e - s):
                        token = flat_tokens[s + i]
                        disambig = disambiguations[local_start + i]
                        if disambig.analyses:
                            ana = disambig.analyses[0].analysis
                            if ana.get("source") == "backoff":
                                rescued = self._rescue_backoff(disambiguator, token)
                                if rescued is not None:
                                    sub_lemmas.append(rescued)
                                else:
                                    backoff_count += 1
                                    sub_lemmas.append(LemmaResult(token))
                            else:
                                sub_lemmas.append(LemmaResult(ana.get("lex") or token, _extract_analysis(ana)))
                        else:
                            sub_lemmas.append(LemmaResult(token))
                    lemmas_map[sub_idx] = sub_lemmas
            except Exception as exc:
                logger.exception("Disambiguation failed for batch at %d", batch_start)
                raise LemmatizationUnavailable(
                    f"{self.language_name} lemmatization failed while processing the subtitles."
                ) from exc

        if backoff_count:
            logger.debug("Backoff fallback used for %d/%d tokens", backoff_count, total)

        # Reassemble in original subtitle order
        result: list[LemmaResult] = []
        for idx in range(len(ranges)):
            if idx in lemmas_map:
                result.extend(lemmas_map[idx])
        return result


class ArabicMSAProcessor(ArabicProcessor):
    _model_name = "msa"

    @property
    def language_code(self) -> str:
        return "ar-msa"

    @property
    def language_name(self) -> str:
        return "Arabic – Modern Standard (MSA)"


class ArabicEGYProcessor(ArabicProcessor):
    _model_name = "egy"

    @property
    def language_code(self) -> str:
        return "ar-egy"

    @property
    def language_name(self) -> str:
        return "Arabic – Egyptian (EGY)"

    def lemmatize(
        self,
        token_sentences: list[list[str]],
        should_cancel: Callable[[], bool] | None = None,
    ) -> list[LemmaResult]:
        results = super().lemmatize(token_sentences, should_cancel)
        tokens = [tok for sentence in token_sentences for tok in sentence]
        return [self._correct(token, result) for token, result in zip(tokens, results)]

    @staticmethod
    def _correct(token: str, result: LemmaResult) -> LemmaResult:
        """Apply the curated Egyptian override table (see egyptian_lexicon).

        calima's analysis describes the wrong word (e.g. أَيّ "which" for إيه), so
        its root/gloss/morphology are dropped rather than shown under our lemma.
        """
        override = egyptian_lexicon.lookup(token)
        if override is None or override[0] == result.lemma:
            return result
        lemma, gloss = override
        return LemmaResult(
            lemma, {"lex": lemma, "gloss": gloss, "camel_lex": result.lemma, "lex_source": "egy-override"}
        )
