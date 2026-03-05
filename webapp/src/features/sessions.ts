import { state } from '../state';
import { flash } from '../ui/flash';
import { renderResults } from '../ui/virtualScroll';
import { resetUpload } from './analyze';
import { getNativeSubtitles, restoreNativeSubtitles } from './subtitleViewer';

let _onAnalysisComplete: (() => void) | null = null;

export function registerSessionAnalysisCompleteHandler(fn: () => void): void {
  _onAnalysisComplete = fn;
}

export async function loadSessions(): Promise<void> {
  if (!IS_LOGGED_IN) return;
  const list = document.getElementById('session-list');
  if (!list) return;
  try {
    const res = await fetch(`/api/sessions?language=${encodeURIComponent(state.currentLanguage)}`);
    if (!res.ok) return;
    const sessions = await res.json();
    if (sessions.length === 0) {
      list.innerHTML = '<div class="text-muted small text-center mt-3">No saved sessions</div>';
      return;
    }
    list.innerHTML = '';
    sessions.forEach((s: { id: number; name: string }) => {
      const item = document.createElement('div');
      item.className = 'session-item' + (s.id === state.activeSessionId ? ' active' : '');
      item.dataset['id'] = String(s.id);
      item.innerHTML = `
        <span class="text-truncate session-name" style="max-width:120px" title="${s.name}">${s.name}</span>
        <div class="d-flex">
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
  } catch (_e) {
    list.innerHTML = '<div class="text-danger small text-center mt-3">Failed to load sessions</div>';
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
  if (Array.isArray(session.native_subtitles) && session.native_subtitles.length > 0) {
    restoreNativeSubtitles(session.native_subtitles);
  }
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
    state.allResults = [];
    document.getElementById('results-section')?.classList.add('d-none');
    document.getElementById('upload-section')?.classList.remove('d-none');
    resetUpload();
    loadSessions();
  });

  document.getElementById('btn-save-session')?.addEventListener('click', async () => {
    if (!IS_LOGGED_IN) {
      try {
        sessionStorage.setItem('pendingSession', JSON.stringify({
          results: state.allResults,
          subtitles: state.parsedSubtitles,
          totalTokens: state.totalTokensCached,
          language: state.currentLanguage,
          filename: state.currentFilename,
          nativeSubtitles: getNativeSubtitles(),
        }));
      } catch (_) { /* sessionStorage unavailable — ignore */ }
      const loginModal = document.getElementById('login-modal');
      const heading = loginModal?.querySelector('h6');
      if (heading) heading.textContent = 'Sign in to save your session';
      const modal = (window as any).bootstrap?.Modal.getOrCreateInstance(loginModal);
      modal?.show();
      return;
    }
    if (!state.allResults.length) return;
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: state.currentLanguage,
        srt_filename: state.currentFilename,
        subtitles: state.parsedSubtitles,
        native_subtitles: getNativeSubtitles(),
        results: state.allResults,
      }),
    });
    if (res.ok) {
      const saved = await res.json();
      state.activeSessionId = saved.id;
      flash('Session saved!');
      loadSessions();
    } else {
      flash('Failed to save session.', 'danger');
    }
  });
}
