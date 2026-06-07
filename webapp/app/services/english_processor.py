import re

from app.services.stanza_processor import StanzaProcessor


class EnglishProcessor(StanzaProcessor):
    _lang = "en"
    _word_re = re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)?")

    @property
    def language_code(self) -> str:
        return "en"

    @property
    def language_name(self) -> str:
        return "English (EN)"
