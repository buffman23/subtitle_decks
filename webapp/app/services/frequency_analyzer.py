from collections import Counter

from app.services.subtitle_parser import parse_srt
from app.services.processor_registry import get_processor


def analyze(
    srt_content: str | bytes,
    language_code: str,
    ignore_set: set[str] | None = None,
) -> tuple[list[dict], int, int, list[dict]]:
    """
    Full analysis pipeline.

    Returns:
        results      — sorted list of {lemma, frequency, ignored} dicts (desc by frequency)
        total_unique — number of unique lemmas
        total_tokens — total lemma count before deduplication
        subtitles    — list of subtitle dicts with character-offset segments
    """
    ignore_set = ignore_set or set()
    processor = get_processor(language_code)

    subtitle_objects = parse_srt(srt_content)

    token_sentences: list[list[str]] = []
    for sub in subtitle_objects:
        token_sentences.append(processor.tokenize(sub.text))

    flat_lemmas = processor.lemmatize(token_sentences)

    # Build per-subtitle segment lists with character offsets
    subtitles = []
    offset = 0
    for sub, tokens in zip(subtitle_objects, token_sentences):
        sub_lemmas = flat_lemmas[offset:offset + len(tokens)]
        offset += len(tokens)
        segments = []
        pos = 0
        for token, lemma_result in zip(tokens, sub_lemmas):
            idx = sub.text.find(token, pos)
            if idx == -1:
                continue
            lemma = lemma_result.lemma
            analysis = lemma_result.analysis
            seg: dict = {"lemma": lemma, "start": idx, "length": len(token)}
            if analysis:
                seg["analysis"] = analysis
            segments.append(seg)
            pos = idx + len(token)
        subtitles.append({
            "index": sub.index,
            "start_time": sub.start_time,
            "end_time": sub.end_time,
            "start_seconds": sub.start_seconds,
            "text": sub.text,
            "segments": segments,
        })

    counter = Counter(result.lemma for result in flat_lemmas)
    total_tokens = sum(counter.values())
    total_unique = len(counter)

    results = [
        {"lemma": lemma, "frequency": freq, "ignored": lemma in ignore_set}
        for lemma, freq in counter.most_common()
    ]

    return results, total_unique, total_tokens, subtitles
