from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Callable


class CancelledAnalysis(Exception):
    """Raised inside the analysis pipeline when a job's cancel flag is set."""


def _process_rss() -> int:
    """Current process resident set size in bytes (0 if psutil unavailable)."""
    try:
        import psutil
        return psutil.Process().memory_info().rss
    except Exception:
        return 0


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
    def lemmatize(
        self,
        token_sentences: list[list[str]],
        should_cancel: Callable[[], bool] | None = None,
    ) -> list[LemmaResult]:
        """
        Take sentence-batched tokens and return a flat list of lemma results.
        analysis is None on fallback/backoff.
        Each inner list is one sentence/subtitle worth of tokens.

        should_cancel, if given, is polled periodically; processors that batch
        their work should raise CancelledAnalysis when it returns True so a
        running job can be cancelled mid-flight.
        """

    # --- Model lifecycle (for admin load/unload + status) -------------------

    # When True, the model is unloaded after each analysis to free RAM (and its
    # RAM usage is not measured). Defaults to True. Stored on the (singleton)
    # processor instance, so it is toggleable at runtime from the admin page.
    _auto_unload: bool = True
    # Resident RAM (bytes) measured the last time the model was loaded with
    # auto_unload off; None until measured.
    _ram_bytes: int | None = None

    @property
    def auto_unload(self) -> bool:
        return self._auto_unload

    @auto_unload.setter
    def auto_unload(self, value: bool) -> None:
        self._auto_unload = bool(value)

    def _load_measured(self, do_load: Callable[[], None]) -> None:
        """Run a model-loading callable, recording the resident RAM it adds.

        Measures process RSS around an actual unloaded->loaded transition, and
        only when auto_unload is off (when on, the footprint isn't tracked).
        Shared by all processors so each gets RAM reporting from one mechanism.
        Note: the first model loaded in a process also absorbs one-time library
        import cost, so its reading reads a little high.
        """
        measure = not self.is_loaded() and not self.auto_unload
        rss_before = _process_rss() if measure else 0
        do_load()
        if measure:
            delta = _process_rss() - rss_before
            if delta > 0:
                self._ram_bytes = delta
        elif self.auto_unload:
            self._ram_bytes = None

    @abstractmethod
    def is_loaded(self) -> bool:
        """True if this processor's model is currently resident in memory."""

    @abstractmethod
    def load(self) -> None:
        """Load the model into memory (no-op if already loaded)."""

    @abstractmethod
    def unload(self) -> None:
        """Release the model from memory (no-op if not loaded)."""

    def ram_bytes(self) -> int | None:
        """Resident RAM the loaded model occupies, or None if unloaded/unmeasured.

        RAM is only tracked while auto_unload is off (see _load_measured), so this
        returns None whenever the model auto-unloads or isn't currently loaded.
        """
        if self.auto_unload or not self.is_loaded():
            return None
        return self._ram_bytes
