import re

from app.services.stanza_processor import StanzaProcessor


class SpanishProcessor(StanzaProcessor):
    _lang = "es"
    _word_re = re.compile(r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:[-'][A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)*")

    @property
    def language_code(self) -> str:
        return "es"

    @property
    def language_name(self) -> str:
        return "Spanish (ES)"
