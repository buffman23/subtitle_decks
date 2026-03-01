from app.services.language_processor import LanguageProcessor
from app.services.arabic_processor import ArabicMSAProcessor, ArabicEGYProcessor

_PROCESSOR_CLASSES: dict[str, type[LanguageProcessor]] = {
    "ar-msa": ArabicMSAProcessor,
    "ar-egy": ArabicEGYProcessor,
    # Add new processors here, e.g.:
    # "fr": FrenchProcessor,
}

_instances: dict[str, LanguageProcessor] = {}


def get_processor(code: str) -> LanguageProcessor:
    if code not in _PROCESSOR_CLASSES:
        raise ValueError(f"No processor registered for language code '{code}'")
    if code not in _instances:
        _instances[code] = _PROCESSOR_CLASSES[code]()
    return _instances[code]


def get_available_languages() -> list[dict]:
    return [
        {"code": code, "name": cls().language_name}
        for code, cls in _PROCESSOR_CLASSES.items()
    ]
