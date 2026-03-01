from app.services.language_processor import LanguageProcessor
from app.services.arabic_processor import ArabicMSAProcessor, ArabicEGYProcessor

# Each entry: code -> {"class": ProcessorClass, "name": display_name}
# The id assigned to each language in the DB is its 1-based position in this dict.
_REGISTRY: dict[str, dict] = {
    "ar-msa": {"class": ArabicMSAProcessor, "name": "Arabic – Modern Standard (MSA)"},
    "ar-egy": {"class": ArabicEGYProcessor, "name": "Arabic – Egyptian (EGY)"},
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
