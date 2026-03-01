from collections import Counter

from app.services.subtitle_parser import parse_srt
from app.services.processor_registry import get_processor


def analyze(
    srt_content: str | bytes,
    language_code: str,
    ignore_set: set[str] | None = None,
) -> tuple[list[dict], int, int]:
    """
    Full analysis pipeline.

    Returns:
        results      — sorted list of {lemma, frequency, ignored} dicts (desc by frequency)
        total_unique — number of unique lemmas
        total_tokens — total lemma count before deduplication
    """
    ignore_set = ignore_set or set()
    processor = get_processor(language_code)

    subtitle_texts = parse_srt(srt_content)

    token_sentences: list[list[str]] = []
    for text in subtitle_texts:
        token_sentences.append(processor.tokenize(text))

    flat_lemmas = processor.lemmatize(token_sentences)

    counter = Counter(flat_lemmas)
    total_tokens = sum(counter.values())
    total_unique = len(counter)

    results = [
        {"lemma": lemma, "frequency": freq, "ignored": lemma in ignore_set}
        for lemma, freq in counter.most_common()
    ]

    return results, total_unique, total_tokens
