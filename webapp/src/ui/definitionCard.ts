/* ── Desktop definition card: opened by clicking an already-selected word in
   the word list (the first click selects it in the subtitles). Mobile shows the
   same content in the Definition tab instead (see features/definitions.ts). ── */
import { renderDefinitions, initDefinitionsContainer } from '../features/definitions';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let cardEl: HTMLElement | null = null;
let cardLemma: string | null = null;

export function hideDefinitionCard(): void {
  if (cardEl) cardEl.style.display = 'none';
  cardLemma = null;
}

function ensureCard(): HTMLElement {
  if (cardEl) return cardEl;
  const el = document.createElement('div');
  el.className = 'definition-card';
  el.setAttribute('role', 'dialog');
  el.innerHTML = `
    <div class="definition-card-header">
      <span class="definition-card-title" dir="auto"></span>
      <button type="button" class="definition-card-close" aria-label="Close">&times;</button>
    </div>
    <div class="definition-card-body"></div>`;
  document.body.appendChild(el);
  el.querySelector('.definition-card-close')?.addEventListener('click', hideDefinitionCard);
  initDefinitionsContainer(el.querySelector<HTMLElement>('.definition-card-body')!);

  // Clicks on the word cell are left to the table (it toggles the card itself).
  document.addEventListener('click', e => {
    const target = e.target as Element;
    if (cardLemma == null || el.contains(target)) return;
    if (target.closest?.('tr.result-row td:nth-child(2)')) return;
    hideDefinitionCard();
  }, true);
  // Scrolling the page/table detaches the card from its word; scrolling the
  // card's own body doesn't.
  document.addEventListener('scroll', e => {
    if (!el.contains(e.target as Node)) hideDefinitionCard();
  }, true);
  window.addEventListener('resize', hideDefinitionCard);
  return cardEl = el;
}

function position(el: HTMLElement, anchor: HTMLElement): void {
  const GAP = 6;
  const rect = anchor.getBoundingClientRect();
  const card = el.getBoundingClientRect();
  let top = rect.bottom + GAP;
  if (top + card.height > window.innerHeight) top = Math.max(GAP, rect.top - card.height - GAP);
  const left = Math.max(GAP, Math.min(rect.left, window.innerWidth - card.width - GAP));
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
}

export function isDefinitionCardOpenFor(lemma: string): boolean {
  return cardLemma === lemma;
}

/** Show the definition card for `lemma` below its word cell. */
export function showDefinitionCard(anchor: HTMLElement, lemma: string): void {
  const el = ensureCard();
  cardLemma = lemma;
  el.querySelector('.definition-card-title')!.innerHTML = escapeHtml(lemma);
  const body = el.querySelector<HTMLElement>('.definition-card-body')!;
  el.style.visibility = 'hidden';
  el.style.display = 'block';
  const done = renderDefinitions(body, lemma);
  position(el, anchor);
  el.style.visibility = 'visible';
  // Re-place once the definitions replace the loading line (height changes).
  void done.then(() => { if (cardLemma === lemma && anchor.isConnected) position(el, anchor); });
}
