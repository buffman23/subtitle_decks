import type { SubtitleEntry } from '../types';
import { expandArabicPos } from './wordTooltip';

// Universal Dependencies UPOS (Stanza, calamancy/spaCy)
const UPOS_LABELS: Record<string, string> = {
  NOUN: 'Noun', PROPN: 'Proper noun', VERB: 'Verb', AUX: 'Auxiliary',
  ADJ: 'Adjective', ADV: 'Adverb', PRON: 'Pronoun', DET: 'Determiner',
  ADP: 'Preposition', CCONJ: 'Conjunction', SCONJ: 'Conjunction',
  PART: 'Particle', INTJ: 'Interjection', NUM: 'Number',
  PUNCT: 'Punctuation', SYM: 'Symbol', X: 'Other',
};

// UniDic pos1 (Japanese)
const UNIDIC_LABELS: Record<string, string> = {
  '名詞': 'Noun', '動詞': 'Verb', '形容詞': 'Adjective', '形状詞': 'Adjectival noun',
  '副詞': 'Adverb', '助詞': 'Particle', '助動詞': 'Auxiliary', '代名詞': 'Pronoun',
  '連体詞': 'Adnominal', '接続詞': 'Conjunction', '感動詞': 'Interjection',
  '接頭辞': 'Prefix', '接尾辞': 'Suffix',
};

export function posLabel(raw: string): string {
  return UPOS_LABELS[raw] ?? UNIDIC_LABELS[raw] ?? expandArabicPos(raw) ?? raw;
}

export interface LemmaPos { top: string; title: string; }

/* Touch devices never show native title tooltips, so a tap on a POS cell shows
   its breakdown in a small popover instead. */
const touchQuery = window.matchMedia('(hover: none)');
let popoverEl: HTMLElement | null = null;
let popoverAnchor: HTMLElement | null = null;

export function hidePosPopover(): void {
  if (popoverEl) popoverEl.style.display = 'none';
  popoverAnchor = null;
}

/** Toggle the POS popover for a tapped cell. Returns false on hover-capable
    devices, where the native title tooltip already covers this. */
export function togglePosPopover(cell: HTMLElement): boolean {
  if (!touchQuery.matches) return false;
  if (popoverAnchor === cell) { hidePosPopover(); return true; }
  const text = cell.title;
  if (!text) { hidePosPopover(); return true; }

  if (!popoverEl) {
    popoverEl = document.createElement('div');
    popoverEl.className = 'pos-popover';
    document.body.appendChild(popoverEl);
    document.addEventListener('click', e => {
      if (popoverAnchor && !popoverAnchor.contains(e.target as Node)) hidePosPopover();
    }, true);
    document.addEventListener('scroll', hidePosPopover, true);
  }
  popoverEl.textContent = text;
  popoverEl.style.visibility = 'hidden';
  popoverEl.style.display = 'block';

  const GAP = 4;
  const rect = cell.getBoundingClientRect();
  const tip = popoverEl.getBoundingClientRect();
  let top = rect.bottom + GAP;
  if (top + tip.height > window.innerHeight) top = rect.top - tip.height - GAP;
  const left = Math.max(GAP, Math.min(rect.left, window.innerWidth - tip.width - GAP));
  popoverEl.style.top = `${top}px`;
  popoverEl.style.left = `${left}px`;
  popoverEl.style.visibility = 'visible';
  popoverAnchor = cell;
  return true;
}

/* Per-lemma POS derived from the subtitle segments. A lemma can be tagged with
   several POS across its occurrences; the most frequent one is shown and the
   full breakdown goes in the title. */
export function buildPosIndex(subtitles: SubtitleEntry[]): Map<string, LemmaPos> {
  const counts = new Map<string, Map<string, number>>();
  for (const sub of subtitles) {
    for (const seg of sub.segments ?? []) {
      const raw = seg.analysis?.pos;
      if (!raw) continue;
      const label = posLabel(raw);
      let byPos = counts.get(seg.lemma);
      if (!byPos) counts.set(seg.lemma, byPos = new Map());
      byPos.set(label, (byPos.get(label) ?? 0) + 1);
    }
  }

  const index = new Map<string, LemmaPos>();
  for (const [lemma, byPos] of counts) {
    const sorted = [...byPos].sort((a, b) => b[1] - a[1]);
    const title = sorted.length > 1 ? sorted.map(([p, n]) => `${p} ×${n}`).join(', ') : sorted[0][0];
    index.set(lemma, { top: sorted[0][0], title });
  }
  return index;
}
