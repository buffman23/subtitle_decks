import { state, buildVisibleIndices } from '../state';
import { flash } from '../ui/flash';
import { updateSummary, renderVirtual } from '../ui/virtualScroll';
import { loadSessions } from './sessions';

export async function addToIgnoreList(word: string, _btn: HTMLButtonElement): Promise<void> {
  if (!IS_LOGGED_IN) {
    new bootstrap.Modal(document.getElementById('login-modal') as HTMLElement).show();
    return;
  }
  const res = await fetch('/api/ignorelist/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ word, language: state.currentLanguage }),
  });
  if (res.ok) {
    flash(`"${word}" added to ignore list.`);
    const item = state.allResults.find(r => r.lemma === word);
    if (item) item.ignored = true;
    buildVisibleIndices();
    updateSummary();
    const wrapper = document.querySelector('.results-table-wrapper') as HTMLElement;
    renderVirtual(wrapper.scrollTop, wrapper.clientHeight);
  } else {
    flash('Failed to add to ignore list.', 'danger');
  }
}

export function initIgnoreList(): void {
  document.getElementById('btn-export-ignorelist')?.addEventListener('click', () => {
    window.location.href = `/api/ignorelist/export?language=${state.currentLanguage}`;
  });
}

// loadSessions is called after ignore mutations when needed (re-exported for convenience)
export { loadSessions };
