import logging
import re
from typing import Callable, ClassVar

from app.services.greek_lexicon import GreekLexicon, default_lexicon_path
from app.services.language_processor import LemmaResult
from app.services.stanza_processor import StanzaProcessor

logger = logging.getLogger(__name__)

# Greek letters: Ά, Έ–Ͽ (skips the Greek question mark U+037E and ano teleia U+0387),
# Greek Extended (polytonic), plus combining diacritics for decomposed text.
_GREEK = r"ΆΈ-Ͽἀ-῿̀-ͯ"

# Stanza (UD GDT) lemmatizes every personal pronoun as "εγώ", and Wiktionary
# lists the weak forms as their own headwords. Map known forms to the dictionary
# headword directly (Stanza's Person feature is unreliable here — it tags σου as
# 1st person); the Person feature is only the fallback for other forms.
_PERSONAL_PRONOUN_FORMS = {
    **dict.fromkeys(("εγώ", "εμένα", "μένα", "με", "μου", "μ", "εμείς", "εμάς", "μας"), "εγώ"),
    **dict.fromkeys(("εσύ", "εσένα", "σένα", "σε", "σου", "σ", "εσείς", "εσάς", "σας"), "εσύ"),
    **dict.fromkeys(("τον", "την", "τη", "το", "του", "της", "τους", "τις", "τα"), "αυτός"),
}
_PERSONAL_PRONOUN_LEMMAS = {"1": "εγώ", "2": "εσύ", "3": "αυτός"}


def _parse_feats(feats: str | None) -> dict[str, str]:
    if not feats:
        return {}
    return dict(part.split("=", 1) for part in feats.split("|") if "=" in part)


class GreekProcessor(StanzaProcessor):
    _lang = "el"
    _word_re = re.compile(rf"[{_GREEK}]+(?:[-'’][{_GREEK}]+)*")
    # Wiktionary lexicon, loaded/unloaded together with the Stanza pipeline so its
    # RAM is counted in the model's measured footprint.
    # None = unloaded, False = unavailable (lemmas fall back to Stanza + pronoun rule).
    _lexicon: ClassVar[object] = None

    @property
    def language_code(self) -> str:
        return "el"

    @property
    def language_name(self) -> str:
        return "Greek (EL)"

    @classmethod
    def preload_pipeline(cls):
        super().preload_pipeline()
        if not cls._pipeline or cls._lexicon is not None:
            return
        path = default_lexicon_path()
        try:
            cls._lexicon = GreekLexicon.load(path)
            logger.info("Greek Wiktionary lexicon loaded (%d keys) from %s", len(cls._lexicon), path)
        except Exception as exc:
            logger.warning("Could not load Greek Wiktionary lexicon from %s: %s", path, exc)
            cls._lexicon = False

    def unload(self) -> None:
        self.__class__._lexicon = None
        super().unload()

    def lemmatize(
        self,
        token_sentences: list[list[str]],
        should_cancel: Callable[[], bool] | None = None,
    ) -> list[LemmaResult]:
        results = super().lemmatize(token_sentences, should_cancel)
        tokens = [token for sentence in token_sentences for token in sentence]
        if len(tokens) != len(results):
            logger.warning(
                "Greek lemma correction skipped: %d tokens vs %d results", len(tokens), len(results)
            )
            return results
        lexicon = self.__class__._lexicon or None
        return [self._correct(token, result, lexicon) for token, result in zip(tokens, results)]

    @staticmethod
    def _correct(token: str, result: LemmaResult, lexicon: GreekLexicon | None) -> LemmaResult:
        analysis = result.analysis or {}
        upos = analysis.get("pos", "")
        feats = _parse_feats(analysis.get("feats"))
        candidates = lexicon.lookup(token) if lexicon else []

        lemma, source = None, None
        lexicon_says_pron = bool(candidates) and all(p == "PRON" for _, p in candidates)
        lexicon_allows_pron = not candidates or any(p == "PRON" for _, p in candidates)
        # Personal pronouns: the fallback for what the lexicon can't resolve. Known
        # forms use the table when either Stanza or the lexicon calls the token a
        # pronoun (σε/το stay prepositions/articles otherwise). Other forms use the
        # Person feature unless the lexicon contradicts the PRON tag — mis-tagged
        # words like "Ρε" or "Είπαμε" have no PRON candidate and go to the lexicon.
        form = token.lower()
        if form in _PERSONAL_PRONOUN_FORMS and (upos == "PRON" or lexicon_says_pron):
            lemma, source = _PERSONAL_PRONOUN_FORMS[form], "pronoun-rule"
        elif (
            upos == "PRON"
            and feats.get("PronType") == "Prs"
            and feats.get("Person") in _PERSONAL_PRONOUN_LEMMAS
            and lexicon_allows_pron
        ):
            lemma, source = _PERSONAL_PRONOUN_LEMMAS[feats["Person"]], "pronoun-rule"
        elif lexicon:
            lemma, source = lexicon.choose(token, candidates, result.lemma, upos), "wiktionary"

        if lemma is None:
            return result
        lemma = lemma.lower()
        if lemma == result.lemma:
            return result
        return LemmaResult(lemma, {**analysis, "lex": lemma, "stanza_lex": result.lemma, "lex_source": source})
