from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass(frozen=True)
class LemmaResult:
    """
    One token's lemmatization result.

    analysis is processor-specific metadata. For example, Arabic processors
    return selected CAMeL Tools fields, while other languages may return POS
    tags, morphology, confidence scores, or no analysis at all.
    """

    lemma: str
    analysis: dict | None = None


class LanguageProcessor(ABC):
    @property
    @abstractmethod
    def language_code(self) -> str:
        """ISO 639-1 code, e.g. 'ar'"""

    @property
    @abstractmethod
    def language_name(self) -> str:
        """Human-readable name, e.g. 'Arabic (العربية)'"""

    @abstractmethod
    def tokenize(self, text: str) -> list[str]:
        """Tokenize a single subtitle string into words."""

    @abstractmethod
    def lemmatize(self, token_sentences: list[list[str]]) -> list[LemmaResult]:
        """
        Take sentence-batched tokens and return a flat list of lemma results.
        analysis is None on fallback/backoff.
        Each inner list is one sentence/subtitle worth of tokens.
        """

    # --- Model lifecycle (for admin load/unload + status) -------------------

    @abstractmethod
    def is_loaded(self) -> bool:
        """True if this processor's model is currently resident in memory."""

    @abstractmethod
    def load(self) -> None:
        """Load the model into memory (no-op if already loaded)."""

    @abstractmethod
    def unload(self) -> None:
        """Release the model from memory (no-op if not loaded)."""
