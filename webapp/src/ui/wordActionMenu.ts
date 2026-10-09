/* ── Mobile: tapping a word in the list opens this menu next to it, asking
   where to go: its subtitles or its definition (the book tab). Styled and
   placed like the POS cell's menu (ui/pos.ts). ── */

export type WordAction = 'subtitles' | 'definition';

let menuEl: HTMLElement | null = null;
let menuAnchor: HTMLElement | null = null;
let menuLemma: string | null = null;
let _onAction: ((lemma: string, action: WordAction) => void) | null = null;

export function registerWordActionHandler(fn: (lemma: string, action: WordAction) => void): void {
  _onAction = fn;
}

export function hideWordActionMenu(): void {
  if (menuEl) menuEl.style.display = 'none';
  menuAnchor = null;
  menuLemma = null;
}

function ensureMenu(): HTMLElement {
  if (menuEl) return menuEl;
  const el = document.createElement('div');
  el.className = 'pos-popover word-action-menu';
  el.setAttribute('role', 'menu');
  el.innerHTML = `
    <button type="button" role="menuitem" class="pos-popover-item" data-action="subtitles">
      <i class="bi bi-badge-cc"></i> Subtitles
    </button>
    <button type="button" role="menuitem" class="pos-popover-item" data-action="definition">
      <i class="bi bi-book"></i> Definition
    </button>`;
  document.body.appendChild(el);
  el.addEventListener('click', e => {
    const item = (e.target as Element).closest<HTMLElement>('.pos-popover-item');
    if (!item || menuLemma == null) return;
    const lemma = menuLemma;
    hideWordActionMenu();
    _onAction?.(lemma, item.dataset['action'] as WordAction);
  });
  document.addEventListener('click', e => {
    const target = e.target as Node;
    if (menuAnchor && !menuAnchor.contains(target) && !el.contains(target)) hideWordActionMenu();
  }, true);
  document.addEventListener('scroll', hideWordActionMenu, true);
  return menuEl = el;
}

/** Toggle the menu for a tapped word cell. */
export function toggleWordActionMenu(cell: HTMLElement, lemma: string): void {
  if (menuAnchor === cell) { hideWordActionMenu(); return; }
  const el = ensureMenu();
  el.style.visibility = 'hidden';
  el.style.display = 'block';

  const GAP = 4;
  const rect = cell.getBoundingClientRect();
  const menu = el.getBoundingClientRect();
  let top = rect.bottom + GAP;
  if (top + menu.height > window.innerHeight) top = rect.top - menu.height - GAP;
  const left = Math.max(GAP, Math.min(rect.left, window.innerWidth - menu.width - GAP));
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
  el.style.visibility = 'visible';
  menuAnchor = cell;
  menuLemma = lemma;
}
