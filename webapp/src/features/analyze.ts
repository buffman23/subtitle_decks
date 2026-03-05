import { state, buildVisibleIndices } from '../state';
import { flash } from '../ui/flash';
import { renderResults, renderVirtual } from '../ui/virtualScroll';
import { loadSessions } from './sessions';

let _onAnalysisComplete: (() => void) | null = null;

export function registerAnalysisCompleteHandler(fn: () => void): void {
  _onAnalysisComplete = fn;
}

let selectedFile: File | null = null;

function setSelectedFile(file: File | null): void {
  selectedFile = file;
  const filename = document.getElementById('drop-zone-filename');
  const btn = document.getElementById('btn-analyze') as HTMLButtonElement | null;
  if (file) {
    if (filename) { filename.textContent = file.name; filename.classList.remove('d-none'); }
    if (btn) btn.disabled = false;
  } else {
    if (filename) { filename.textContent = ''; filename.classList.add('d-none'); }
    if (btn) btn.disabled = true;
  }
}

export function resetUpload(): void {
  setSelectedFile(null);
  const fileInput = document.getElementById('srt-file') as HTMLInputElement | null;
  if (fileInput) fileInput.value = '';
}

export function initAnalyzeForm(): void {
  const form = document.getElementById('analyze-form');
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('srt-file') as HTMLInputElement | null;

  if (!form || !dropZone || !fileInput) return;

  // Click on drop zone → open file picker
  dropZone.addEventListener('click', () => fileInput.click());

  // File picker selection
  fileInput.addEventListener('change', () => {
    setSelectedFile(fileInput.files?.[0] ?? null);
  });

  // Drag events
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer?.files[0] ?? null;
    if (file && file.name.endsWith('.srt')) {
      setSelectedFile(file);
    } else if (file) {
      flash('Please drop an .srt file.', 'warning');
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!selectedFile) { flash('Please select an SRT file.', 'warning'); return; }

    state.currentFilename = selectedFile.name;

    const formData = new FormData();
    formData.append('file', selectedFile);
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
