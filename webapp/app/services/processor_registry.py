from app.services.language_processor import LanguageProcessor
from app.services.arabic_processor import ArabicMSAProcessor, ArabicEGYProcessor
from app.services.english_processor import EnglishProcessor
from app.services.german_processor import GermanProcessor
from app.services.spanish_processor import SpanishProcessor
from app.services.tagalog_processor import TagalogProcessor
from app.services.japanese_processor import JapaneseProcessor
from app.services.greek_processor import GreekProcessor

# Each entry: code -> {"class": ProcessorClass, "name": display_name}
# The id assigned to each language in the DB is its 1-based position in this dict.
_REGISTRY: dict[str, dict] = {
    "ar-msa": {"class": ArabicMSAProcessor, "name": "Arabic – Modern Standard (MSA)"},
    "ar-egy": {"class": ArabicEGYProcessor, "name": "Arabic – Egyptian (EGY)"},
    "en": {"class": EnglishProcessor, "name": "English (EN)"},
    "de": {"class": GermanProcessor, "name": "German (DE)"},
    "es": {"class": SpanishProcessor, "name": "Spanish (ES)"},
    "tl": {"class": TagalogProcessor, "name": "Tagalog (TL)"},
    "ja": {"class": JapaneseProcessor, "name": "Japanese (JA)"},
    "el": {"class": GreekProcessor, "name": "Greek (EL)"},
    # Add new processors here, e.g.:
    # "fr": {"class": FrenchProcessor, "name": "French"},
}

_instances: dict[str, LanguageProcessor] = {}


def get_processor(code: str) -> LanguageProcessor:
    if code not in _REGISTRY:
        raise ValueError(f"No processor registered for language code '{code}'")
    if code not in _instances:
        _instances[code] = _REGISTRY[code]["class"]()
    return _instances[code]


def get_available_languages() -> list[dict]:
    return [{"code": code, "name": info["name"]} for code, info in _REGISTRY.items()]
