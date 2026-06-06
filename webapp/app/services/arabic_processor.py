import re
import logging

from app.services.language_processor import LanguageProcessor, LemmaResult

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
            cls._disambiguators[model] = BERTUnfactoredDisambiguator.pretrained(model, use_gpu=True)
            logger.info("BERTUnfactoredDisambiguator loaded: %s", model)
        except Exception as exc:
            logger.warning(
                "Could not load BERTUnfactoredDisambiguator (%s): %s — falling back to raw tokens.", model, exc
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

    def lemmatize(self, token_sentences: list[list[str]]) -> list[LemmaResult]:
        disambiguator = self._get_disambiguator()
        if disambiguator is None:
            return [LemmaResult(tok) for sentence in token_sentences for tok in sentence]

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
                                backoff_count += 1
                                sub_lemmas.append(LemmaResult(token))
                            else:
                                sub_lemmas.append(LemmaResult(ana.get("lex") or token, _extract_analysis(ana)))
                        else:
                            sub_lemmas.append(LemmaResult(token))
                    lemmas_map[sub_idx] = sub_lemmas
            except Exception as exc:
                logger.debug("Disambiguation failed for batch at %d: %s", batch_start, exc)
                for sub_idx in batch:
                    s, e = ranges[sub_idx]
                    lemmas_map[sub_idx] = [LemmaResult(tok) for tok in flat_tokens[s:e]]

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


def preload_all():
    ArabicMSAProcessor.preload_disambiguator()
    ArabicEGYProcessor.preload_disambiguator()
