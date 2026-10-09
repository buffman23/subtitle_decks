import { state } from '../state';

/* The ? button next to #pos-select opens #pos-help-modal (the About page's POS
   glossary). When a word is selected, its parts of speech are highlighted and
   scrolled into view so the relevant definitions come first. */
export function initPosHelp(): void {
  const modal = document.getElementById('pos-help-modal');
  if (!modal) return;

  modal.addEventListener('show.bs.modal', () => {
    modal.querySelectorAll('tr.table-warning').forEach(tr => tr.classList.remove('table-warning'));
    const counts = state.selectedLemma ? state.posByLemma.get(state.selectedLemma)?.counts ?? [] : [];
    for (const [pos] of counts) {
      modal.querySelectorAll<HTMLElement>(`tr[data-pos-label="${CSS.escape(pos)}"]`).forEach(tr => {
        tr.classList.add('table-warning');
        const details = tr.closest('details');
        if (details) details.open = true;
      });
    }
  });

  modal.addEventListener('shown.bs.modal', () => {
    const first = modal.querySelector<HTMLElement>('tr.table-warning');
    if (first) first.scrollIntoView({ block: 'center' });
    else modal.querySelector('.modal-body')?.scrollTo({ top: 0 });
  });
}
