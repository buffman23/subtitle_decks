import { state } from '../state';
import { flash } from '../ui/flash';
import { renderResults } from '../ui/virtualScroll';
import { resetUpload, viewPendingAnalysis, cancelPendingAnalysis } from './analyze';
import { getNativeSubtitles, restoreNativeSubtitles } from './subtitleViewer';

let _onAnalysisComplete: (() => void) | null = null;

export function registerSessionAnalysisCompleteHandler(fn: () => void): void {
  _onAnalysisComplete = fn;
}

function langAbbr(code: string): string {
  const parts = code.split('-');
  return parts[parts.length - 1].toUpperCase();
}

/**
 * Render (or remove) the in-progress analysis placeholder at the top of the
 * sessions sidebar. The name is shown translucent with a spinner so the user
 * can tell an analysis is still running and click back into it.
 */
export function renderPending(): void {
  const list = document.getElementById('session-list');
  if (!list) return;
  let item = document.getElementById('pending-session-item');
  const pj = state.pendingJob;
  if (!pj) { item?.remove(); return; }

  // Build the static structure only once. On subsequent calls (polling updates
  // the status every second) we mutate only the text/state of existing nodes —
  // never the spinner element — so its CSS rotation animation keeps looping
  // smoothly instead of restarting on each re-render.
  if (!item) {
    item = document.createElement('div');
    item.id = 'pending-session-item';
    item.addEventListener('click', (e) => {
      if ((e.target as Element).closest('.btn-cancel-pending')) {
        cancelPendingAnalysis();
      } else {
        viewPendingAnalysis();
      }
    });
    item.innerHTML = `
      <div class="d-flex align-items-center gap-2 flex-grow-1 min-width-0">
        <span class="spinner-border spinner-border-sm flex-shrink-0 text-secondary" role="status" aria-hidden="true"></span>
        <span class="text-truncate session-name pending-name"></span>
        <span class="badge bg-secondary fw-normal flex-shrink-0 pending-lang" style="font-size:0.6rem"></span>
      </div>
      <span class="small text-muted flex-shrink-0 ms-1 pending-status"></span>
      <button class="btn btn-sm btn-link text-danger flex-shrink-0 btn-cancel-pending" title="Cancel analysis">
        <i class="bi bi-x-lg"></i>
      </button>`;
    list.prepend(item);
  } else if (item !== list.firstChild) {
    list.prepend(item);
  }

  const statusLabel = pj.cancelling
    ? 'Cancelling'
    : pj.status === 'queued'
      ? (pj.position ? `In queue · #${pj.position}` : 'In queue')
      : 'Analyzing';
  item.className = 'session-item pending-session' + (state.viewingPending ? ' active' : '');

  const nameEl = item.querySelector('.pending-name') as HTMLElement;
  nameEl.textContent = pj.filename;
  nameEl.title = pj.filename;
  (item.querySelector('.pending-lang') as HTMLElement).textContent = langAbbr(pj.language);
  (item.querySelector('.pending-status') as HTMLElement).textContent = statusLabel;
  (item.querySelector('.btn-cancel-pending') as HTMLButtonElement).disabled = pj.cancelling;
}

export async function loadSessions(): Promise<void> {
  if (!IS_LOGGED_IN) { renderPending(); return; }
  const list = document.getElementById('session-list');
  if (!list) return;
  try {
    const res = await fetch('/api/sessions');
    if (!res.ok) { renderPending(); return; }
    const sessions = await res.json();
    if (sessions.length === 0) {
      list.innerHTML = '<div class="text-muted small text-center mt-3">No saved sessions</div>';
      renderPending();
      return;
    }
    list.innerHTML = '';
    sessions.forEach((s: { id: number; name: string; language: string }) => {
      const item = document.createElement('div');
      item.className = 'session-item' + (s.id === state.activeSessionId ? ' active' : '');
      item.dataset['id'] = String(s.id);
      item.innerHTML = `
        <div class="d-flex align-items-center gap-1 flex-grow-1 min-width-0">
          <span class="text-truncate session-name" title="${s.name}">${s.name}</span>
          <span class="badge bg-secondary fw-normal flex-shrink-0" style="font-size:0.6rem">${langAbbr(s.language)}</span>
        </div>
        <div class="d-flex flex-shrink-0">
          <button class="btn btn-sm btn-link text-secondary btn-rename" title="Rename">
            <i class="bi bi-pencil"></i>
          </button>
          <button class="btn btn-sm btn-link text-danger btn-delete" title="Delete">
            <i class="bi bi-trash3"></i>
          </button>
        </div>`;
      item.addEventListener('click', (e) => {
        if ((e.target as Element).closest('.btn-delete')) {
          deleteSession(s.id);
        } else if ((e.target as Element).closest('.btn-rename')) {
          startRename(item, s.id, s.name);
        } else {
          openSession(s.id);
        }
      });
      list.appendChild(item);
    });
    renderPending();
  } catch (_e) {
    list.innerHTML = '<div class="text-danger small text-center mt-3">Failed to load sessions</div>';
    renderPending();
  }
}

function startRename(item: HTMLElement, id: number, currentName: string): void {
  const nameSpan = item.querySelector('.session-name') as HTMLElement;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'form-control form-control-sm';
  input.value = currentName;
  input.style.cssText = 'width:130px;padding:1px 4px;font-size:0.8rem';
  nameSpan.replaceWith(input);
  input.focus();
  input.select();

  async function commit() {
    input.removeEventListener('blur', commit);
    const newName = input.value.trim();
    if (newName && newName !== currentName) {
      const res = await fetch(`/api/sessions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        flash(body.detail ?? 'Failed to rename session.', 'danger');
        return;
      }
    }
    loadSessions();
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { input.removeEventListener('blur', commit); loadSessions(); }
  });
  input.addEventListener('blur', commit);
}

async function openSession(id: number): Promise<void> {
  const res = await fetch(`/api/sessions/${id}`);
  if (!res.ok) { flash('Could not load session.', 'danger'); return; }
  // Leaving the in-progress analysis: it keeps running in the background and
  // stays in the sidebar, but its result should no longer hijack this view.
  state.viewingPending = false;
  const session = await res.json();
  state.currentLanguage = session.language;
  // Sync the global language picker
  const picker = document.getElementById('language-select') as HTMLSelectElement | null;
  if (picker && picker.value !== session.language) {
    picker.value = session.language;
    localStorage.setItem('subtitleAnalyzer.language', session.language);
  }
  state.currentFilename = session.srt_filename;
  state.parsedSubtitles = session.subtitles ?? [];
  state.activeSessionId = id;

  // Re-apply current ignore list so additions/removals since save are reflected
  const igRes = await fetch(`/api/ignorelist?language=${session.language}`);
  if (igRes.ok) {
    const entries: { word: string }[] = await igRes.json();
    const ignoreSet = new Set(entries.map(e => e.word));
    for (const r of session.results) {
      r.ignored = ignoreSet.has(r.lemma);
    }
  }

  state.allResults = session.results;
  renderResults(session.results, session.results.reduce((a: number, r: { frequency: number }) => a + r.frequency, 0));
  if (_onAnalysisComplete) _onAnalysisComplete();
  restoreNativeSubtitles(Array.isArray(session.native_subtitles) && session.native_subtitles.length > 0
    ? session.native_subtitles : []);
  loadSessions();
}

async function deleteSession(id: number): Promise<void> {
  if (!confirm('Delete this session?')) return;
  const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
  if (res.ok) {
    if (state.activeSessionId === id) {
      state.activeSessionId = null;
      document.getElementById('results-section')?.classList.add('d-none');
      document.getElementById('upload-section')?.classList.remove('d-none');
    }
    loadSessions();
  } else {
    flash('Failed to delete session.', 'danger');
  }
}

export function stashPendingSession(): void {
  if (!state.allResults.length) return;
  try {
    sessionStorage.setItem('pendingSession', JSON.stringify({
      results: state.allResults,
      subtitles: state.parsedSubtitles,
      totalTokens: state.totalTokensCached,
      language: state.currentLanguage,
      filename: state.currentFilename,
      nativeSubtitles: getNativeSubtitles(),
    }));
  } catch (_) { /* sessionStorage unavailable — silently ignore */ }
}

export async function checkPendingSession(): Promise<void> {
  const raw = sessionStorage.getItem('pendingSession');
  if (raw) {
    sessionStorage.removeItem('pendingSession');
    try {
      const { results, subtitles, totalTokens, language, filename, nativeSubtitles } = JSON.parse(raw);
      state.currentLanguage = language;
      state.currentFilename = filename;
      state.parsedSubtitles = subtitles;
      state.allResults = results;
      const picker = document.getElementById('language-select') as HTMLSelectElement | null;
      if (picker && picker.value !== language) {
        picker.value = language;
        localStorage.setItem('subtitleAnalyzer.language', language);
      }
      renderResults(results, totalTokens);
      if (_onAnalysisComplete) _onAnalysisComplete();
      if (Array.isArray(nativeSubtitles) && nativeSubtitles.length > 0) {
        restoreNativeSubtitles(nativeSubtitles);
      }
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language, srt_filename: filename, subtitles, native_subtitles: nativeSubtitles ?? [], results }),
      });
      if (res.ok) {
        const saved = await res.json();
        state.activeSessionId = saved.id;
        flash('Session saved!');
      }
    } catch (_) { /* corrupt storage — silently discard */ }
  }
  loadSessions();
}

export function initSessions(): void {
  document.getElementById('btn-new-session')?.addEventListener('click', () => {
    state.activeSessionId = null;
    state.viewingPending = false;
    state.allResults = [];
    document.getElementById('results-section')?.classList.add('d-none');
    document.getElementById('upload-section')?.classList.remove('d-none');
    // The user has moved on from the previous analysis; drop any stashed copy
    // so a later sign-in doesn't unexpectedly resurrect it.
    try { sessionStorage.removeItem('pendingSession'); } catch (_) { /* ignore */ }
    resetUpload();
    loadSessions();
  });
}
