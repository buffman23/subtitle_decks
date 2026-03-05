import type { WordFrequency } from '../types';
import { state, buildVisibleIndices } from '../state';

let ROW_HEIGHT = 33;      // Bootstrap table-sm row height in px — recalibrated after first render
const SCROLL_BUFFER = 10; // extra rows rendered above/below viewport

let _topSpacer: HTMLTableRowElement | null = null;
let _bottomSpacer: HTMLTableRowElement | null = null;

let _onIgnore: ((word: string, btn: HTMLButtonElement) => void) | null = null;
let _onUnignore: ((word: string, btn: HTMLButtonElement) => void) | null = null;
let _onLemmaSelect: ((lemma: string) => void) | null = null;

export function registerIgnoreHandler(fn: (word: string, btn: HTMLButtonElement) => void): void {
  _onIgnore = fn;
}

export function registerUnignoreHandler(fn: (word: string, btn: HTMLButtonElement) => void): void {
  _onUnignore = fn;
}

export function registerLemmaSelectHandler(fn: (lemma: string) => void): void {
  _onLemmaSelect = fn;
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

export function scrollTableToLemma(lemma: string): void {
  state.selectedLemma = lemma;
  const vi = state.visibleIndices.findIndex(origIdx => state.allResults[origIdx].lemma === lemma);
  if (vi === -1) return;
  const wrapper = document.querySelector('.results-table-wrapper') as HTMLElement | null;
  if (!wrapper) return;
  wrapper.scrollTop = vi * ROW_HEIGHT;
  renderVirtual(wrapper.scrollTop, wrapper.clientHeight);
}

export function renderVirtual(scrollTop: number, containerHeight: number): void {
  const tbody = document.getElementById('results-tbody');
  if (!tbody) return;

  const total = state.visibleIndices.length;
  if (total === 0) {
    tbody.innerHTML = '';
    _topSpacer = null;
    _bottomSpacer = null;
    return;
  }

  const firstVisible = Math.floor(scrollTop / ROW_HEIGHT);
  const lastVisible  = Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT);
  const renderStart  = Math.max(0, firstVisible - SCROLL_BUFFER);
  const renderEnd    = Math.min(total, lastVisible + SCROLL_BUFFER);

  /* Initialise persistent spacers if they don't exist yet */
  if (!_topSpacer || !tbody.contains(_topSpacer)) {
    tbody.innerHTML = '';
    _topSpacer    = document.createElement('tr');
    _bottomSpacer = document.createElement('tr');
    tbody.appendChild(_topSpacer);
    tbody.appendChild(_bottomSpacer);
  }

  /* Update spacer heights — this keeps total scroll height stable */
  _topSpacer.style.height    = (renderStart * ROW_HEIGHT) + 'px';
  _bottomSpacer!.style.height = ((total - renderEnd) * ROW_HEIGHT) + 'px';

  /* Build new content rows */
  const fragment = document.createDocumentFragment();
  for (let vi = renderStart; vi < renderEnd; vi++) {
    const origIdx = state.visibleIndices[vi];
    const row = state.allResults[origIdx];
    const tr = document.createElement('tr');
    if (row.lemma === state.selectedLemma) tr.classList.add('selected-row');
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
    tr.innerHTML = `
      <td class="text-muted">${origIdx + 1}</td>
      <td>${escapeHtml(row.lemma)}</td>
      <td>${row.frequency}</td>
      <td>${actionBtn}</td>`;
    tr.addEventListener('click', (e) => {
      const target = e.target as Element;
      if (target.closest('button')) return;
      if (target.closest('td') !== tr.children[1]) return;
      if (window.getSelection()?.toString()) return;
      state.selectedLemma = row.lemma;
      if (_onLemmaSelect) _onLemmaSelect(row.lemma);
      const wrapper = document.querySelector('.results-table-wrapper') as HTMLElement | null;
      if (wrapper) renderVirtual(wrapper.scrollTop, wrapper.clientHeight);
    });
    fragment.appendChild(tr);
  }

  /* Remove old content rows, keeping only the two spacers */
  [...tbody.children].forEach(child => {
    if (child !== _topSpacer && child !== _bottomSpacer) child.remove();
  });

  /* Insert new rows before the bottom spacer */
  _bottomSpacer!.before(fragment);

  tbody.querySelectorAll<HTMLButtonElement>('.btn-ignorelist').forEach(btn => {
    btn.addEventListener('click', () => {
      const word = btn.dataset['word'];
      if (word && _onIgnore) _onIgnore(word, btn);
    });
  });
  tbody.querySelectorAll<HTMLButtonElement>('.btn-unignore').forEach(btn => {
    btn.addEventListener('click', () => {
      const word = btn.dataset['word'];
      if (word && _onUnignore) _onUnignore(word, btn);
    });
  });

  /* Recalibrate ROW_HEIGHT from an actual rendered row (runs cheaply after each render) */
  const contentRow = [...tbody.children].find(tr => tr !== _topSpacer && tr !== _bottomSpacer) as HTMLElement | undefined;
  if (contentRow && contentRow.offsetHeight > 0 && contentRow.offsetHeight !== ROW_HEIGHT) {
    ROW_HEIGHT = contentRow.offsetHeight;
    /* Immediately correct the spacer heights with the true row height */
    _topSpacer.style.height    = (renderStart * ROW_HEIGHT) + 'px';
    _bottomSpacer!.style.height = ((total - renderEnd) * ROW_HEIGHT) + 'px';
  }
}

export function renderResults(results: WordFrequency[], totalTokens: number): void {
  state.allResults = results;
  state.totalTokensCached = totalTokens;
  state.showingIgnored = false;
  state.selectedLemma = null;
  buildVisibleIndices();
  updateSummary();

  const toggleBtn = document.getElementById('btn-toggle-ignored');
  if (toggleBtn) toggleBtn.innerHTML = '<i class="bi bi-eye-slash"></i> Show ignored';

  document.getElementById('upload-section')?.classList.add('d-none');
  document.getElementById('results-section')?.classList.remove('d-none');

  const wrapper = document.querySelector('.results-table-wrapper');
  renderVirtual(
    (wrapper as HTMLElement)?.scrollTop ?? 0,
    (wrapper as HTMLElement)?.clientHeight || Math.floor(window.innerHeight * 0.6),
  );
}
