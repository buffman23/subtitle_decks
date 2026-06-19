import { state, buildVisibleIndices } from '../state';
import { flash } from '../ui/flash';
import { renderResults, renderVirtual } from '../ui/virtualScroll';
import { loadSessions, stashPendingSession, renderPending } from './sessions';
import { renderShareControls, hideShareControls } from './sharing';

let _onAnalysisComplete: (() => void) | null = null;

export function registerAnalysisCompleteHandler(fn: () => void): void {
  _onAnalysisComplete = fn;
}

let selectedFile: File | null = null;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Mirror of the server-side humanize_bytes (B / KB / MB / GB). */
function humanizeBytes(num: number): string {
  let size = num || 0;
  const units = ['B', 'KB', 'MB', 'GB'];
  for (let i = 0; i < units.length; i++) {
    if (size < 1024 || i === units.length - 1) {
      return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
    }
    size /= 1024;
  }
  return `${num} B`;
}

/** Reject (with a flash) a file that exceeds the configured upload cap. */
function withinSizeLimit(file: File): boolean {
  if (file.size > MAX_UPLOAD_BYTES) {
    flash(
      `"${file.name}" is too large (${humanizeBytes(file.size)}). ` +
        `The maximum allowed size is ${humanizeBytes(MAX_UPLOAD_BYTES)}.`,
      'danger',
    );
    return false;
  }
  return true;
}

/** Update the inline spinner's status line from the pending job's state. */
function updatePendingStatusText(): void {
  const pj = state.pendingJob;
  const statusText = document.getElementById('analyze-status-text');
  if (!pj || !statusText) return;
  statusText.textContent = pj.cancelling
    ? 'Cancelling…'
    : pj.status === 'queued'
      ? (pj.position ? `In queue — position ${pj.position}…` : 'In queue…')
      : 'Analyzing…';
}

/** Lock/unlock the file picker and language selector during an analysis. */
function setUploadControlsDisabled(disabled: boolean): void {
  const fileInput = document.getElementById('srt-file') as HTMLInputElement | null;
  const langSelect = document.getElementById('language-select') as HTMLSelectElement | null;
  if (fileInput) fileInput.disabled = disabled;
  if (langSelect) langSelect.disabled = disabled;
  document.getElementById('drop-zone')?.classList.toggle('disabled', disabled);
}

/** Show the "analyzing" view: the upload pane with its spinner, results hidden. */
function showAnalyzingView(): void {
  document.getElementById('results-section')?.classList.add('d-none');
  document.getElementById('upload-section')?.classList.remove('d-none');
  document.getElementById('analyze-spinner')?.classList.remove('d-none');
  const cancelBtn = document.getElementById('btn-cancel-analyze') as HTMLButtonElement | null;
  if (cancelBtn) { cancelBtn.classList.remove('d-none'); cancelBtn.disabled = false; }
  const btn = document.getElementById('btn-analyze') as HTMLButtonElement | null;
  if (btn) btn.disabled = true;
  setUploadControlsDisabled(true);
  updatePendingStatusText();
}

/** Sync the upload controls (button, spinner, cancel, file/language) with pending state. */
function updateAnalyzeButton(): void {
  const btn = document.getElementById('btn-analyze') as HTMLButtonElement | null;
  if (state.pendingJob) {
    if (btn) btn.disabled = true;
    setUploadControlsDisabled(true);
    return;
  }
  document.getElementById('analyze-spinner')?.classList.add('d-none');
  document.getElementById('btn-cancel-analyze')?.classList.add('d-none');
  setUploadControlsDisabled(false);
  if (btn) btn.disabled = !selectedFile;
}

/** Request cancellation of the in-progress analysis. */
export async function cancelPendingAnalysis(): Promise<void> {
  const pj = state.pendingJob;
  if (!pj || pj.cancelling) return;
  pj.cancelling = true;
  const cancelBtn = document.getElementById('btn-cancel-analyze') as HTMLButtonElement | null;
  if (cancelBtn) cancelBtn.disabled = true;
  updatePendingStatusText();
  renderPending();
  try {
    await fetch(`/api/analyze/jobs/${encodeURIComponent(pj.jobId)}/cancel`, { method: 'POST' });
    // The poll loop will observe the 'cancelled' status and reset the view.
  } catch (_) { /* poll loop reflects the real outcome */ }
}

/**
 * Re-attach the main view to the in-progress analysis. Called when the user
 * clicks the pending placeholder in the sessions sidebar after navigating away.
 */
export function viewPendingAnalysis(): void {
  const pj = state.pendingJob;
  if (!pj) return;
  state.viewingPending = true;
  state.activeSessionId = null;
  // Restore the language context to the in-progress analysis — the user may
  // have opened a saved session in a different language while it ran, which
  // changed the picker.
  state.currentLanguage = pj.language;
  const picker = document.getElementById('language-select') as HTMLSelectElement | null;
  if (picker && picker.value !== pj.language) {
    picker.value = pj.language;
    localStorage.setItem('subtitleAnalyzer.language', pj.language);
  }
  showAnalyzingView();
  renderPending();
}

/**
 * Poll a queued analysis job until it finishes, keeping the pending state and
 * sidebar placeholder up to date. Returns the analysis result on success, or
 * null if the job failed or was cancelled (a flash message is shown for those).
 */
async function pollJob(jobId: string): Promise<any | null> {
  while (true) {
    const res = await fetch(`/api/analyze/jobs/${encodeURIComponent(jobId)}`);
    if (!res.ok) {
      flash('Lost track of the analysis job.', 'danger');
      return null;
    }
    const job = await res.json();
    if (state.pendingJob && state.pendingJob.jobId === jobId) {
      state.pendingJob.status = job.status;
      state.pendingJob.position = job.position ?? null;
    }
    renderPending();
    if (state.viewingPending) updatePendingStatusText();

    if (job.status === 'done') return job.result;
    if (job.status === 'cancelled') { flash('Analysis was cancelled.', 'warning'); return null; }
    if (job.status === 'failed') { flash(job.error || 'Analysis failed.', 'danger'); return null; }
    await sleep(1000);
  }
}

/**
 * Run an analysis job to completion in the background. The user may navigate
 * away (to a saved session) and back via the sidebar placeholder while this
 * runs; results are only rendered into the main view if they're still watching.
 */
async function startAnalysisJob(jobId: string, filename: string, language: string): Promise<void> {
  state.pendingJob = { jobId, filename, language, status: 'queued', position: null, cancelling: false };
  state.viewingPending = true;
  showAnalyzingView();
  renderPending();

  let result: any = null;
  try {
    result = await pollJob(jobId);
  } catch (err) {
    flash('Network error: ' + (err as Error).message, 'danger');
  }

  const wasViewing = state.viewingPending;
  state.pendingJob = null;
  state.viewingPending = false;

  if (!result) {
    // Failed/cancelled/error — message already shown. Leave the upload view in
    // place (if they were watching) so they can retry.
    updateAnalyzeButton();
    renderPending();
    return;
  }

  await completeAnalysis(result, filename, language, wasViewing);
  updateAnalyzeButton();
  renderPending();
}

/** Persist the finished analysis and, if still watching, render it. */
async function completeAnalysis(
  result: any,
  filename: string,
  language: string,
  wasViewing: boolean,
): Promise<void> {
  let savedId: number | null = null;
  if (IS_LOGGED_IN) {
    try {
      const saveRes = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language,
          srt_filename: filename,
          subtitles: result.subtitles ?? [],
          native_subtitles: [],
          results: result.results,
        }),
      });
      if (saveRes.ok) savedId = (await saveRes.json()).id;
    } catch (_) { /* non-critical */ }
  }

  if (wasViewing) {
    state.currentLanguage = language;
    state.currentFilename = filename;
    state.parsedSubtitles = result.subtitles ?? [];
    state.activeSessionId = savedId;
    state.activeSessionOwned = true;
    renderResults(result.results, result.total_tokens);
    // A freshly saved analysis is owned with no recipients yet; otherwise hide.
    if (savedId) renderShareControls(savedId, true, []);
    else hideShareControls();
    if (_onAnalysisComplete) _onAnalysisComplete();
    if (savedId) flash('Session saved!');
    else if (!IS_LOGGED_IN) stashPendingSession();
  } else {
    flash(`Analysis of "${filename}" is ready.`, 'success');
  }

  if (IS_LOGGED_IN) loadSessions();
}

function setSelectedFile(file: File | null): void {
  selectedFile = file;
  const filename = document.getElementById('drop-zone-filename');
  const btn = document.getElementById('btn-analyze') as HTMLButtonElement | null;
  if (file) {
    if (filename) { filename.textContent = file.name; filename.classList.remove('d-none'); }
    if (btn) btn.disabled = !!state.pendingJob;
  } else {
    if (filename) { filename.textContent = ''; filename.classList.add('d-none'); }
    if (btn) btn.disabled = true;
  }
}

export function resetUpload(): void {
  setSelectedFile(null);
  const fileInput = document.getElementById('srt-file') as HTMLInputElement | null;
  if (fileInput) fileInput.value = '';
  // Keep controls locked if an analysis is still running in the background.
  setUploadControlsDisabled(!!state.pendingJob);
}

export function initAnalyzeForm(): void {
  const form = document.getElementById('analyze-form');
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('srt-file') as HTMLInputElement | null;

  if (!form || !dropZone || !fileInput) return;

  // Click on drop zone → open file picker (ignored while an analysis runs)
  dropZone.addEventListener('click', () => { if (!state.pendingJob) fileInput.click(); });

  // Cancel the in-progress analysis
  document.getElementById('btn-cancel-analyze')?.addEventListener('click', () => {
    void cancelPendingAnalysis();
  });

  // File picker selection
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0] ?? null;
    if (file && !withinSizeLimit(file)) {
      fileInput.value = '';
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
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
    if (state.pendingJob) return;
    const file = e.dataTransfer?.files[0] ?? null;
    if (file && file.name.endsWith('.srt')) {
      if (withinSizeLimit(file)) setSelectedFile(file);
    } else if (file) {
      flash('Please drop an .srt file.', 'warning');
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!selectedFile) { flash('Please select an SRT file.', 'warning'); return; }
    if (state.pendingJob) {
      flash('An analysis is already running — please wait for it to finish.', 'warning');
      viewPendingAnalysis();
      return;
    }

    const filename = selectedFile.name;
    const language = state.currentLanguage;
    state.currentFilename = filename;

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('language', language);

    const btn = document.getElementById('btn-analyze') as HTMLButtonElement;
    btn.disabled = true;
    showAnalyzingView();
    const statusText = document.getElementById('analyze-status-text');
    if (statusText) statusText.textContent = 'Submitting…';

    try {
      // Submit the analysis as a queued job; the lifecycle (queue position,
      // polling, completion) is owned by startAnalysisJob so the user can
      // navigate away and return to it via the sidebar while it runs.
      const submitRes = await fetch('/api/analyze', { method: 'POST', body: formData });
      const submitData = await submitRes.json();
      if (!submitRes.ok) {
        flash(submitData.detail || 'Analysis failed.', 'danger');
        updateAnalyzeButton();
        return;
      }
      // Intentionally not awaited: let it run in the background.
      void startAnalysisJob(submitData.job_id, filename, language);
    } catch (err) {
      flash('Network error: ' + (err as Error).message, 'danger');
      updateAnalyzeButton();
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
      ? '<i class="bi bi-eye"></i> <span class="btn-label">Hide ignored</span>'
      : '<i class="bi bi-eye-slash"></i> <span class="btn-label">Show ignored</span>';
  });
}
