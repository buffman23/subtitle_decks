import { state, buildVisibleIndices } from '../state';
import { flash } from '../ui/flash';
import { renderResults, renderVirtual } from '../ui/virtualScroll';
import { loadSessions } from './sessions';

let _onAnalysisComplete: (() => void) | null = null;

export function registerAnalysisCompleteHandler(fn: () => void): void {
  _onAnalysisComplete = fn;
}

export function initAnalyzeForm(): void {
  const form = document.getElementById('analyze-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const fileInput = document.getElementById('srt-file') as HTMLInputElement;

    if (!fileInput.files?.[0]) { flash('Please select an SRT file.', 'warning'); return; }

    state.currentFilename = fileInput.files[0].name;

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    formData.append('language', state.currentLanguage);

    const btn = document.getElementById('btn-analyze') as HTMLButtonElement;
    const spinner = document.getElementById('analyze-spinner');
    btn.disabled = true;
    spinner?.classList.remove('d-none');

    try {
      const res = await fetch('/api/analyze', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) { flash(data.detail || 'Analysis failed.', 'danger'); return; }
      state.activeSessionId = null;
      state.parsedSubtitles = data.subtitles ?? [];
      renderResults(data.results, data.total_tokens);
      if (_onAnalysisComplete) _onAnalysisComplete();
      if (IS_LOGGED_IN) loadSessions();
    } catch (err) {
      flash('Network error: ' + (err as Error).message, 'danger');
    } finally {
      btn.disabled = false;
      spinner?.classList.add('d-none');
    }
  });
}

export function initToggleIgnored(): void {
  document.getElementById('btn-toggle-ignored')?.addEventListener('click', function (this: HTMLElement) {
    state.showingIgnored = !state.showingIgnored;
    buildVisibleIndices();
    const wrapper = document.querySelector('.results-table-wrapper') as HTMLElement;
    wrapper.scrollTop = 0;
    renderVirtual(0, wrapper.clientHeight);
    this.innerHTML = state.showingIgnored
      ? '<i class="bi bi-eye"></i> Hide ignored'
      : '<i class="bi bi-eye-slash"></i> Show ignored';
  });
}
