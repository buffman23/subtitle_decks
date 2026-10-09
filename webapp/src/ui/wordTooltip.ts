import type { WordAnalysis } from '../types';
import { CAMEL_VALUE_LABELS, cliticLabel, expandUdFeats, pgnPhrase, posLabel } from './morphLabels';

// Technical fields, shown only inside the collapsed "Details" section.
const DETAIL_LABELS: Array<[string, string]> = [
  ['diac', 'Diacritized'], ['bw', 'Buckwalter'], ['caphi', 'CAPHI'], ['pattern', 'Pattern'],
  ['orth_base', 'Base form'], ['xpos', 'Tag'], ['feats', 'Features'],
];

const PROCLITIC_FIELDS = ['prc3', 'prc2', 'prc1', 'prc0'];
const ENCLITIC_FIELDS = ['enc0', 'enc1', 'enc2'];

/** Values the processors use for "not applicable / absent". */
function isEmpty(v: string | undefined): v is undefined {
  return v == null || v === '' || v === 'na' || v === '0' || v === 'u';
}

function camelValue(ana: Record<string, string | undefined>, field: string): string | undefined {
  const raw = ana[field];
  if (isEmpty(raw)) return undefined;
  return CAMEL_VALUE_LABELS[field]?.[raw] ?? raw;
}

/** Grammar summary, e.g. ["3rd person masculine singular", "Perfective", "Active"]. */
function grammarParts(ana: Record<string, string | undefined>): string[] {
  if (ana['feats']) return expandUdFeats(ana['feats']);

  const parts: string[] = [];
  // Person + gender + number read best as one phrase.
  const pgn = pgnPhrase(['per', 'gen', 'num']
    .map(f => camelValue(ana, f))
    .filter((v): v is string => !!v));
  if (pgn) parts.push(pgn);
  for (const f of ['asp', 'vox', 'mod', 'stt', 'cas']) {
    const v = camelValue(ana, f);
    if (v) parts.push(v);
  }
  return parts;
}

function cleanGloss(raw: string): string {
  return raw
    // Source tags ("_[CALIMA]", "[ARAMORPH]") and markers like "<verb>".
    .replace(/_?\[[A-Z]+\]/g, '')
    .replace(/<[a-z]+>/g, '')
    .replace(/_/g, ' ')
    // CAMeL joins clitic and stem glosses with "+" ("for;to+truth;right").
    .replace(/\s*\+\s*/g, ' + ')
    .replace(/;(?=\S)/g, '; ')
    .trim();
}

let tooltipEl: HTMLElement | null = null;
let anchorEl: HTMLElement | null = null;

export function initWordTooltip(): void {
  tooltipEl = document.createElement('div');
  tooltipEl.id = 'word-tooltip';
  tooltipEl.className = 'word-tooltip';
  tooltipEl.style.display = 'none';
  document.body.appendChild(tooltipEl);

  document.addEventListener('click', e => {
    if (tooltipEl && !tooltipEl.contains(e.target as Node)) {
      // Let sub-word click handlers manage the tooltip themselves
      if ((e.target as Element).closest?.('.sub-word[data-lemma]')) return;
      hideWordTooltip();
    }
  }, true);
}

export function hideWordTooltip(): void {
  if (tooltipEl) tooltipEl.style.display = 'none';
  anchorEl = null;
}

export function isWordTooltipVisible(): boolean {
  return !!tooltipEl && tooltipEl.style.display !== 'none';
}

export function isWordTooltipAnchor(el: HTMLElement): boolean {
  return isWordTooltipVisible() && anchorEl === el;
}

function buildBody(ana: Record<string, string | undefined>): string {
  let html = '';

  const lemma = ana['lex'];
  const pos = isEmpty(ana['pos']) ? undefined : posLabel(ana['pos']);
  if (lemma || pos) {
    html += '<div class="word-tooltip-lemma-row">';
    if (lemma) html += `<span class="word-tooltip-lemma" dir="auto">${escapeHtml(lemma)}</span>`;
    if (pos) html += `<span class="word-tooltip-pos-chip">${escapeHtml(pos)}</span>`;
    html += '</div>';
  }

  if (ana['reading'] && ana['reading'] !== lemma) {
    html += `<div class="word-tooltip-reading">${escapeHtml(ana['reading'])}</div>`;
  }
  if (ana['gloss']) {
    html += `<div class="word-tooltip-gloss">${escapeHtml(cleanGloss(ana['gloss']))}</div>`;
  }
  if (!isEmpty(ana['root'])) {
    html += `<div class="word-tooltip-root"><span class="word-tooltip-muted">Root</span>`
      + ` <span dir="auto">${escapeHtml(ana['root'])}</span></div>`;
  }

  const grammar = grammarParts(ana);
  if (grammar.length) {
    html += `<div class="word-tooltip-grammar">${grammar.map(escapeHtml).join(' · ')}</div>`;
  }

  const clitics = [...PROCLITIC_FIELDS, ...ENCLITIC_FIELDS]
    .filter(f => !isEmpty(ana[f]))
    .map(f => {
      const label = cliticLabel(f, ana[f]!);
      const text = f.startsWith('prc') ? `${label} +` : `+ ${label}`;
      return `<span class="word-tooltip-clitic">${escapeHtml(text)}</span>`;
    });
  if (clitics.length) {
    html += `<div class="word-tooltip-clitics">${clitics.join('')}</div>`;
  }

  // Skip values that just repeat the lemma or POS (e.g. Greek xpos "VERB").
  const details = DETAIL_LABELS.filter(([f]) =>
    !isEmpty(ana[f]) && ana[f] !== lemma && ana[f] !== ana['pos']);
  if (details.length) {
    html += '<details class="word-tooltip-details"><summary>Details</summary><dl class="word-tooltip-dl">';
    for (const [f, label] of details) {
      // Buckwalter mixes Arabic stems with Latin tags; auto direction scrambles it.
      const dir = f === 'bw' ? 'ltr' : 'auto';
      html += `<dt>${label}</dt><dd dir="${dir}">${escapeHtml(String(ana[f]))}</dd>`;
    }
    html += '</dl></details>';
  }

  return html;
}

export function showWordTooltip(analysis: WordAnalysis, anchor: HTMLElement, token?: string): void {
  anchorEl = anchor;
  if (!tooltipEl) return;

  const ana = analysis as Record<string, string | undefined>;
  const title = token ?? ana['lex'] ?? '';
  tooltipEl.innerHTML = `
    <div class="word-tooltip-header">
      <span class="word-tooltip-title" dir="auto">${escapeHtml(title)}</span>
      <button class="word-tooltip-close" aria-label="Close">&times;</button>
    </div>
    <div class="word-tooltip-body">${buildBody(ana)}</div>`;

  tooltipEl.querySelector('.word-tooltip-close')?.addEventListener('click', e => {
    e.stopPropagation();
    hideWordTooltip();
  });

  // Show off-screen first to measure
  tooltipEl.style.display = 'block';
  tooltipEl.style.visibility = 'hidden';
  tooltipEl.style.position = 'fixed';
  tooltipEl.style.top = '0';
  tooltipEl.style.left = '0';

  const anchorRect = anchor.getBoundingClientRect();
  const tip = tooltipEl.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const GAP = 6;
  let top = anchorRect.bottom + GAP;
  let left = anchorRect.left;

  // Flip above if clipped at bottom
  if (top + tip.height > vh) top = anchorRect.top - tip.height - GAP;
  // Shift left if clipped at right
  if (left + tip.width > vw) left = vw - tip.width - GAP;
  if (left < 0) left = GAP;

  tooltipEl.style.top = `${top}px`;
  tooltipEl.style.left = `${left}px`;
  tooltipEl.style.visibility = 'visible';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
