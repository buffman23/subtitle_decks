import type { WordFrequency } from '../types';
import { state, buildVisibleIndices } from '../state';
import { buildPosIndex, togglePosPopover, hidePosPopover, posAbbr } from './pos';
import { showDefinitionCard, hideDefinitionCard, isDefinitionCardOpenFor } from './definitionCard';
import { toggleWordActionMenu, hideWordActionMenu } from './wordActionMenu';
import { isMobileLayout } from '../features/mobileTabs';

let _onIgnore: ((word: string, btn: HTMLButtonElement) => void) | null = null;
let _onUnignore: ((word: string, btn: HTMLButtonElement) => void) | null = null;
let _onLemmaSelect: ((lemma: string) => void) | null = null;
let _onCardSelect: ((lemmas: string[], checked: boolean) => void) | null = null;

// The card-selection column exists only for signed-in users on their own
// pages (the header cell is rendered under the same condition in index.html).
export const cardColumnEnabled = (): boolean => IS_LOGGED_IN && !DEMO_MODE;

export function registerIgnoreHandler(fn: (word: string, btn: HTMLButtonElement) => void): void {
  _onIgnore = fn;
}

export function registerUnignoreHandler(fn: (word: string, btn: HTMLButtonElement) => void): void {
  _onUnignore = fn;
}

export function registerLemmaSelectHandler(fn: (lemma: string) => void): void {
  _onLemmaSelect = fn;
}

export function registerCardSelectHandler(
  fn: (lemmas: string[], checked: boolean) => void,
): void {
  _onCardSelect = fn;
}

export function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function updateSummary(): void {
  const ignoredCount = state.allResults.filter(r => r.ignored).length;
  const summary = document.getElementById('result-summary');
  if (!summary) return;
  summary.textContent = ignoredCount > 0
    ? `${state.allResults.length} unique lemmas (${ignoredCount} ignored) · ${state.totalTokensCached} total tokens`
    : `${state.allResults.length} unique lemmas · ${state.totalTokensCached} total tokens`;
}

function rowHtml(origIdx: number): string {
  const row = state.allResults[origIdx];
  const selected = row.lemma === state.selectedLemma ? ' selected-row' : '';
  const pos = state.posByLemma.get(row.lemma);
  const actionBtn = (row.ignored && state.showingIgnored)
    ? `<button class="btn btn-outline-danger btn-sm btn-unignore"
               data-word="${escapeHtml(row.lemma)}"
               title="Remove from ignore list">
         <i class="bi bi-eye"></i>
       </button>`
    : `<button class="btn btn-outline-secondary btn-sm btn-ignorelist"
               data-word="${escapeHtml(row.lemma)}"
               title="Add to ignore list"
               ${row.ignored ? 'disabled' : ''}>
         <i class="bi bi-eye-slash"></i>
       </button>`;
  return `<tr class="result-row${selected}" id="result-row-${origIdx}" data-lemma="${escapeHtml(row.lemma)}">
      <td class="text-muted">${origIdx + 1}</td>
      <td>${escapeHtml(row.lemma)}</td>
      <td class="pos-cell"${pos ? ` title="${escapeHtml(pos.top)}"` : ''}>${pos ? escapeHtml(posAbbr(pos.top)) : ''}</td>
      <td>${row.frequency}</td>
      <td>${actionBtn}</td>${cardColumnEnabled() ? `
      <td class="card-select-cell"><input type="checkbox" class="form-check-input card-select"
          aria-label="Select for card creation"${state.cardSelection.has(row.lemma) ? ' checked' : ''}></td>` : ''}
    </tr>`;
}

/* Render every visible lemma row into the table in normal document flow. No
   virtualization: the browser lays the rows out and owns the scroll geometry,
   so hiding/unhiding a word never shifts scroll position. Frequency lists top
   out around a couple thousand lemmas, well within what the browser renders
   fine. A single delegated listener on the tbody handles all row/button clicks,
   so re-rendering doesn't have to re-wire thousands of listeners. */
export function renderTable(): void {
  const tbody = document.getElementById('results-tbody');
  if (!tbody) return;
  hidePosPopover();  // its anchor cell is about to be replaced
  hideDefinitionCard();
  hideWordActionMenu();
  let html = '';
  for (const origIdx of state.visibleIndices) html += rowHtml(origIdx);
  tbody.innerHTML = html;
  updateSelectAllCheckbox();
}

// Header checkbox: checked when every visible row is selected, indeterminate
// when only some are.
export function updateSelectAllCheckbox(): void {
  const all = document.getElementById('card-select-all') as HTMLInputElement | null;
  if (!all) return;
  const visible = state.visibleIndices.map(i => state.allResults[i].lemma);
  const n = visible.filter(l => state.cardSelection.has(l)).length;
  all.checked = n > 0 && n === visible.length;
  all.indeterminate = n > 0 && n < visible.length;
}

let _delegated = false;

function ensureDelegation(): void {
  if (_delegated) return;
  const tbody = document.getElementById('results-tbody');
  if (!tbody) return;
  _delegated = true;

  tbody.addEventListener('change', (e) => {
    const input = (e.target as Element).closest<HTMLInputElement>('input.card-select');
    const lemma = input?.closest<HTMLElement>('tr.result-row')?.dataset['lemma'];
    if (input && lemma != null && _onCardSelect) _onCardSelect([lemma], input.checked);
  });
  document.getElementById('card-select-all')?.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const visible = state.visibleIndices.map(i => state.allResults[i].lemma);
    if (_onCardSelect) _onCardSelect(visible, input.checked);
  });

  tbody.addEventListener('click', (e) => {
    const target = e.target as Element;

    const ignoreBtn = target.closest<HTMLButtonElement>('.btn-ignorelist');
    if (ignoreBtn) {
      const word = ignoreBtn.dataset['word'];
      if (word && _onIgnore) _onIgnore(word, ignoreBtn);
      return;
    }
    const unignoreBtn = target.closest<HTMLButtonElement>('.btn-unignore');
    if (unignoreBtn) {
      const word = unignoreBtn.dataset['word'];
      if (word && _onUnignore) _onUnignore(word, unignoreBtn);
      return;
    }
    const posCell = target.closest<HTMLElement>('td.pos-cell');
    if (posCell) {
      const lemma = posCell.closest<HTMLElement>('tr.result-row')?.dataset['lemma'];
      if (lemma != null) togglePosPopover(posCell, lemma);
      return;
    }

    // Lemma selection: only when the lemma cell (2nd column) itself is clicked,
    // and not while the user is selecting text.
    const tr = target.closest<HTMLTableRowElement>('tr.result-row');
    if (!tr) return;
    if (target.closest('td') !== tr.children[1]) return;
    if (window.getSelection()?.toString()) return;
    const lemma = tr.dataset['lemma'];
    if (lemma == null) return;
    // Mobile: a tap opens a menu by the word (subtitles or definition).
    if (isMobileLayout()) {
      toggleWordActionMenu(tr.children[1] as HTMLElement, lemma);
      return;
    }
    // Desktop: the first click selects the word in the subtitles; clicking the
    // selected word again toggles its definition card.
    if (lemma === state.selectedLemma) {
      if (isDefinitionCardOpenFor(lemma)) hideDefinitionCard();
      else showDefinitionCard(tr.children[1] as HTMLElement, lemma);
      return;
    }
    state.selectedLemma = lemma;
    if (_onLemmaSelect) _onLemmaSelect(lemma);
    renderTable();
  });
}

export function scrollTableToLemma(lemma: string): void {
  state.selectedLemma = lemma;
  renderTable();
  const origIdx = state.allResults.findIndex(r => r.lemma === lemma);
  if (origIdx === -1) return;
  const el = document.getElementById(`result-row-${origIdx}`);
  const wrapper = document.querySelector('.results-table-wrapper') as HTMLElement | null;
  if (!el || !wrapper) return;
  const itemTop = el.getBoundingClientRect().top - wrapper.getBoundingClientRect().top + wrapper.scrollTop;
  const itemHeight = el.offsetHeight;
  wrapper.scrollTop = Math.max(0, itemTop - wrapper.clientHeight / 2 + itemHeight / 2);
}

export function renderResults(results: WordFrequency[], totalTokens: number): void {
  state.allResults = results;
  state.totalTokensCached = totalTokens;
  state.showingIgnored = false;
  state.selectedLemma = null;
  state.cardSelection = new Set();  // a session's selection is restored from its draft
  state.posByLemma = buildPosIndex(state.parsedSubtitles);
  buildVisibleIndices();
  updateSummary();

  const toggleBtn = document.getElementById('btn-toggle-ignored');
  if (toggleBtn) toggleBtn.innerHTML = '<i class="bi bi-eye-slash"></i> <span class="btn-label">Show ignored</span>';

  document.getElementById('upload-section')?.classList.add('d-none');
  document.getElementById('results-section')?.classList.remove('d-none');

  ensureDelegation();
  renderTable();
  const wrapper = document.querySelector('.results-table-wrapper') as HTMLElement | null;
  if (wrapper) wrapper.scrollTop = 0;
}
