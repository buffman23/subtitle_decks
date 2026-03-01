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

export async function removeFromIgnoreList(word: string, _btn: HTMLButtonElement): Promise<void> {
  if (!IS_LOGGED_IN) {
    new bootstrap.Modal(document.getElementById('login-modal') as HTMLElement).show();
    return;
  }
  const res = await fetch('/api/ignorelist/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ word, language: state.currentLanguage }),
  });
  if (res.ok) {
    flash(`"${word}" removed from ignore list.`);
    const item = state.allResults.find(r => r.lemma === word);
    if (item) item.ignored = false;
    buildVisibleIndices();
    updateSummary();
    const wrapper = document.querySelector('.results-table-wrapper') as HTMLElement;
    renderVirtual(wrapper.scrollTop, wrapper.clientHeight);
  } else {
    flash('Failed to remove from ignore list.', 'danger');
  }
}

export function initIgnoreList(): void {
  // Upload ignore list via FAB
  const fileInput = document.getElementById('ignore-list-file') as HTMLInputElement;

  document.getElementById('btn-fab-upload-ignorelist')?.addEventListener('click', () => {
    if (!IS_LOGGED_IN) {
      new bootstrap.Modal(document.getElementById('login-modal') as HTMLElement).show();
      return;
    }
    fileInput?.click();
  });

  fileInput?.addEventListener('change', async () => {
    if (!fileInput.files?.[0]) return;
    const fd = new FormData();
    fd.append('file', fileInput.files[0]);
    fd.append('language', state.currentLanguage || 'ar-msa');
    fileInput.value = '';

    const res = await fetch('/api/ignorelist/import', { method: 'POST', body: fd });
    if (!res.ok) { flash('Failed to import ignore list.', 'danger'); return; }

    const data = await res.json();
    flash(`Imported ${data.imported} word(s) to ignore list.`);

    // Apply newly imported words to current results immediately
    if (state.allResults.length) {
      const igRes = await fetch(`/api/ignorelist?language=${state.currentLanguage}`);
      if (igRes.ok) {
        const entries: { word: string }[] = await igRes.json();
        const ignoreSet = new Set(entries.map(e => e.word));
        let changed = false;
        for (const r of state.allResults) {
          if (!r.ignored && ignoreSet.has(r.lemma)) { r.ignored = true; changed = true; }
        }
        if (changed) {
          buildVisibleIndices();
          updateSummary();
          const wrapper = document.querySelector('.results-table-wrapper') as HTMLElement;
          renderVirtual(wrapper.scrollTop, wrapper.clientHeight);
        }
      }
    }
  });

  // Export ignore list via FAB
  document.getElementById('btn-export-ignorelist')?.addEventListener('click', () => {
    window.location.href = `/api/ignorelist/export?language=${state.currentLanguage}`;
  });
}

// loadSessions is called after ignore mutations when needed (re-exported for convenience)
export { loadSessions };
