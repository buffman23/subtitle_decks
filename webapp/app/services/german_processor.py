import re

from app.services.stanza_processor import StanzaProcessor


class GermanProcessor(StanzaProcessor):
    _lang = "de"
    _word_re = re.compile(r"[A-Za-zÄÖÜäöüß]+(?:[-'][A-Za-zÄÖÜäöüß]+)*")

    @property
    def language_code(self) -> str:
        return "de"

    @property
    def language_name(self) -> str:
        return "German (DE)"
