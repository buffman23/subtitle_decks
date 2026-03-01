from abc import ABC, abstractmethod


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
    def lemmatize(self, token_sentences: list[list[str]]) -> list[str]:
        """
        Take sentence-batched tokens and return a flat list of lemmas.
        Each inner list is one sentence/subtitle worth of tokens.
        """
