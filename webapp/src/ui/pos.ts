import type { SubtitleEntry } from '../types';
import { state } from '../state';
import { posLabel } from './morphLabels';

export { posLabel };

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Dictionary-style abbreviations for the full labels above (all tagsets).
const POS_ABBREVIATIONS: Record<string, string> = {
  'Noun': 'n.', 'Proper noun': 'prop. n.', 'Verb': 'v.', 'Auxiliary': 'aux.',
  'Adjective': 'adj.', 'Adverb': 'adv.', 'Pronoun': 'pron.', 'Determiner': 'det.',
  'Preposition': 'prep.', 'Conjunction': 'conj.', 'Particle': 'part.',
  'Interjection': 'interj.', 'Number': 'num.', 'Punctuation': 'punct.',
  'Symbol': 'sym.', 'Other': 'other',
  // UniDic
  'Adjectival noun': 'adj. n.', 'Adnominal': 'adnom.', 'Prefix': 'pref.', 'Suffix': 'suf.',
  // CAMeL Tools
  'Number noun': 'num. n.', 'Quantity noun': 'quant. n.',
  'Comparative adjective': 'comp. adj.', 'Numerical adjective': 'num. adj.',
  'Interrogative adverb': 'interrog. adv.', 'Relative adverb': 'rel. adv.',
  'Demonstrative pronoun': 'dem. pron.', 'Exclamatory pronoun': 'excl. pron.',
  'Interrogative pronoun': 'interrog. pron.', 'Relative pronoun': 'rel. pron.',
  'Pseudo verb': 'pseudo v.',
  'Demonstrative particle': 'dem. part.', 'Determiner particle': 'det. part.',
  'Focus particle': 'focus part.', 'Future marker particle': 'fut. part.',
  'Interrogative particle': 'interrog. part.', 'Negative particle': 'neg. part.',
  'Restrictive particle': 'restr. part.', 'Verbal particle': 'verb. part.',
  'Vocative particle': 'voc. part.', 'Abbreviation': 'abbr.',
  'Subordinating conjunction': 'sub. conj.', 'Digit': 'digit', 'Latin/Foreign': 'foreign',
};

/** Short form of a full POS label (falls back to the label itself). */
export function posAbbr(label: string): string {
  // Short labels (Noun, Verb, Adverb...) read fine as they are.
  if (label.length <= 6) return label;
  const abbr = (POS_ABBREVIATIONS[label] ?? label).replace(/\./g, '');
  return abbr.charAt(0).toUpperCase() + abbr.slice(1);
}

/** POS breakdown for one lemma: counts sorted descending; `top` is the first. */
export interface LemmaPos { top: string; counts: [string, number][]; }

/* Clicking a POS cell opens a menu of the lemma's POS. Picking one selects
   that lemma + POS in the subtitle navigation (the Word cell selects all POS). */
let popoverEl: HTMLElement | null = null;
let popoverAnchor: HTMLElement | null = null;
let popoverLemma: string | null = null;
let _onPosPick: ((lemma: string, pos: string | null) => void) | null = null;

export function registerPosPickHandler(fn: (lemma: string, pos: string | null) => void): void {
  _onPosPick = fn;
}

export function hidePosPopover(): void {
  if (popoverEl) popoverEl.style.display = 'none';
  popoverAnchor = null;
  popoverLemma = null;
}

function ensurePopover(): HTMLElement {
  if (popoverEl) return popoverEl;
  const el = document.createElement('div');
  el.className = 'pos-popover';
  el.setAttribute('role', 'menu');
  document.body.appendChild(el);
  el.addEventListener('click', e => {
    const item = (e.target as Element).closest<HTMLElement>('.pos-popover-item');
    if (!item || popoverLemma == null) return;
    const lemma = popoverLemma;
    hidePosPopover();
    _onPosPick?.(lemma, item.dataset['pos'] || null);
  });
  document.addEventListener('click', e => {
    const target = e.target as Node;
    if (popoverAnchor && !popoverAnchor.contains(target) && !el.contains(target)) hidePosPopover();
  }, true);
  document.addEventListener('scroll', hidePosPopover, true);
  return popoverEl = el;
}

/** Toggle the POS menu for a clicked cell. */
export function togglePosPopover(cell: HTMLElement, lemma: string): void {
  if (popoverAnchor === cell) { hidePosPopover(); return; }
  const info = state.posByLemma.get(lemma);
  if (!info) { hidePosPopover(); return; }

  const el = ensurePopover();
  const current = state.selectedLemma === lemma ? (state.selectedPos ?? '') : null;
  const item = (pos: string, label: string) =>
    `<button type="button" role="menuitem" class="pos-popover-item${current === pos ? ' active' : ''}"`
    + ` data-pos="${escapeHtml(pos)}">${escapeHtml(label)}</button>`;
  el.innerHTML = info.counts.map(([pos, n]) => item(pos, `${pos} ×${n}`)).join('');
  el.style.visibility = 'hidden';
  el.style.display = 'block';

  const GAP = 4;
  const rect = cell.getBoundingClientRect();
  const tip = el.getBoundingClientRect();
  let top = rect.bottom + GAP;
  if (top + tip.height > window.innerHeight) top = rect.top - tip.height - GAP;
  const left = Math.max(GAP, Math.min(rect.left, window.innerWidth - tip.width - GAP));
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
  el.style.visibility = 'visible';
  popoverAnchor = cell;
  popoverLemma = lemma;
}

/* Per-lemma POS derived from the subtitle segments. A lemma can be tagged with
   several POS across its occurrences; the most frequent one is shown in the
   table and the full breakdown goes in the click menu. */
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
    index.set(lemma, { top: sorted[0][0], counts: sorted });
  }
  return index;
}
