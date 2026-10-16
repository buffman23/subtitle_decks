// Pure subtitle helpers shared by the main app's subtitle viewer and the card
// wizard (no DOM or app state).
import type { SubtitleEntry } from '../types';

function endSeconds(s: SubtitleEntry): number {
  return parseTimeToSeconds(s.end_time);
}

// Half-open interval overlap: a starts before b ends AND b starts before a ends.
function overlaps(a: SubtitleEntry, b: SubtitleEntry): boolean {
  return a.start_seconds < endSeconds(b) && b.start_seconds < endSeconds(a);
}

// All entries in `pool` whose time range overlaps `target`; falls back to the single
// nearest-by-start entry when none overlap (never returns empty if pool is non-empty).
export function findOverlapping(target: SubtitleEntry, pool: SubtitleEntry[]): SubtitleEntry[] {
  const hits = pool.filter(s => overlaps(s, target));
  if (hits.length > 0) return hits;
  if (pool.length === 0) return [];
  const nearest = pool.reduce((best, s) =>
    Math.abs(s.start_seconds - target.start_seconds) < Math.abs(best.start_seconds - target.start_seconds)
      ? s : best);
  return [nearest];
}

export function parseTimeToSeconds(time: string): number {
  const normalized = time.replace(',', '.');
  const dotIdx = normalized.lastIndexOf('.');
  const hms = normalized.slice(0, dotIdx);
  const ms = parseFloat('0.' + normalized.slice(dotIdx + 1));
  const parts = hms.split(':').map(Number);
  return parts[0] * 3600 + parts[1] * 60 + parts[2] + ms;
}

// One appearance of a lemma: the subtitle (array position) and its segment.
export interface LemmaHit { pos: number; start: number; length: number; }

// Every appearance of `lemma` in reading order, as positions in `subs`.
export function lemmaHits(subs: SubtitleEntry[], lemma: string): LemmaHit[] {
  const hits: LemmaHit[] = [];
  subs.forEach((sub, pos) => {
    const segs = sub.segments.filter(s => s.lemma === lemma).sort((a, b) => a.start - b.start);
    for (const seg of segs) hits.push({ pos, start: seg.start, length: seg.length });
  });
  return hits;
}
