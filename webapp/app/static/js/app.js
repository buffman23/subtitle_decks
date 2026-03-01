/* ── State ── */
let currentLanguage = 'ar-msa';
let currentFilename = '';
let currentSrtText = '';
let activeSessionId = null;
let showingIgnored = false;

/* ── Virtual scroll state ── */
let allResults = [];
let visibleIndices = [];
let totalTokensCached = 0;
const ROW_HEIGHT = 33;   // Bootstrap table-sm row height in px
const SCROLL_BUFFER = 10; // extra rows rendered above/below viewport

function buildVisibleIndices() {
  visibleIndices = [];
  for (let i = 0; i < allResults.length; i++) {
    if (showingIgnored || !allResults[i].ignored) visibleIndices.push(i);
  }
}

function updateSummary() {
  const ignoredCount = allResults.filter(r => r.ignored).length;
  const summary = document.getElementById('result-summary');
  if (!summary) return;
  summary.textContent = ignoredCount > 0
    ? `${allResults.length} unique lemmas (${ignoredCount} ignored) · ${totalTokensCached} total tokens`
    : `${allResults.length} unique lemmas · ${totalTokensCached} total tokens`;
}

function renderVirtual(scrollTop, containerHeight) {
  const tbody = document.getElementById('results-tbody');
  if (!tbody) return;

  const total = visibleIndices.length;
  if (total === 0) { tbody.innerHTML = ''; return; }

  const firstVisible = Math.floor(scrollTop / ROW_HEIGHT);
  const lastVisible  = Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT);
  const renderStart  = Math.max(0, firstVisible - SCROLL_BUFFER);
  const renderEnd    = Math.min(total, lastVisible + SCROLL_BUFFER);

  const fragment = document.createDocumentFragment();

  if (renderStart > 0) {
    const spacer = document.createElement('tr');
    spacer.style.height = (renderStart * ROW_HEIGHT) + 'px';
    fragment.appendChild(spacer);
  }

  for (let vi = renderStart; vi < renderEnd; vi++) {
    const origIdx = visibleIndices[vi];
    const row = allResults[origIdx];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="text-muted">${origIdx + 1}</td>
      <td>${escapeHtml(row.lemma)}</td>
      <td>${row.frequency}</td>
      <td>
        <button class="btn btn-outline-secondary btn-sm btn-ignorelist"
                data-word="${escapeHtml(row.lemma)}"
                title="Add to ignore list"
                ${row.ignored ? 'disabled' : ''}>
          <i class="bi bi-eye-slash"></i>
        </button>
      </td>`;
    fragment.appendChild(tr);
  }

  if (renderEnd < total) {
    const spacer = document.createElement('tr');
    spacer.style.height = ((total - renderEnd) * ROW_HEIGHT) + 'px';
    fragment.appendChild(spacer);
  }

  tbody.innerHTML = '';
  tbody.appendChild(fragment);

  tbody.querySelectorAll('.btn-ignorelist').forEach(btn => {
    btn.addEventListener('click', () => addToIgnoreList(btn.dataset.word, btn));
  });
}

/* ── Language select with localStorage persistence ── */
const languageSelect = document.getElementById('language-select');
if (languageSelect) {
  const saved = localStorage.getItem('subtitleAnalyzer.language');
  if (saved && [...languageSelect.options].some(o => o.value === saved)) {
    languageSelect.value = saved;
  }
  languageSelect.addEventListener('change', () => {
    localStorage.setItem('subtitleAnalyzer.language', languageSelect.value);
  });
}

/* ── Helpers ── */
function flash(msg, type = 'success') {
  const container = document.getElementById('flash-container');
  const el = document.createElement('div');
  el.className = `alert alert-${type} flash-alert shadow`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

/* ── Sessions sidebar ── */
async function loadSessions() {
  if (!IS_LOGGED_IN) return;
  const list = document.getElementById('session-list');
  try {
    const res = await fetch('/api/sessions');
    if (!res.ok) return;
    const sessions = await res.json();
    if (sessions.length === 0) {
      list.innerHTML = '<div class="text-muted small text-center mt-3">No saved sessions</div>';
      return;
    }
    list.innerHTML = '';
    sessions.forEach(s => {
      const item = document.createElement('div');
      item.className = 'session-item' + (s.id === activeSessionId ? ' active' : '');
      item.dataset.id = s.id;
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
        if (e.target.closest('.btn-delete')) {
          deleteSession(s.id);
        } else if (e.target.closest('.btn-rename')) {
          startRename(item, s.id, s.name);
        } else {
          openSession(s.id);
        }
      });
      list.appendChild(item);
    });
  } catch (e) {
    list.innerHTML = '<div class="text-danger small text-center mt-3">Failed to load sessions</div>';
  }
}

function startRename(item, id, currentName) {
  const nameSpan = item.querySelector('.session-name');
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
      if (!res.ok) flash('Failed to rename session.', 'danger');
    }
    loadSessions();
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { input.removeEventListener('blur', commit); loadSessions(); }
  });
  input.addEventListener('blur', commit);
}

async function openSession(id) {
  const res = await fetch(`/api/sessions/${id}`);
  if (!res.ok) { flash('Could not load session.', 'danger'); return; }
  const session = await res.json();
  allResults = session.results;
  currentLanguage = session.language;
  currentFilename = session.srt_filename;
  currentSrtText = session.srt_content;
  activeSessionId = id;
  renderResults(session.results, session.results.reduce((a, r) => a + r.frequency, 0));
  loadSessions();
}

async function deleteSession(id) {
  if (!confirm('Delete this session?')) return;
  const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
  if (res.ok) {
    if (activeSessionId === id) {
      activeSessionId = null;
      document.getElementById('results-section').classList.add('d-none');
    }
    loadSessions();
  } else {
    flash('Failed to delete session.', 'danger');
  }
}

document.getElementById('btn-new-session')?.addEventListener('click', () => {
  activeSessionId = null;
  allResults = [];
  document.getElementById('results-section').classList.add('d-none');
  document.getElementById('srt-file').value = '';
  loadSessions();
});

/* ── Analyze form ── */
document.getElementById('analyze-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const fileInput = document.getElementById('srt-file');
  const ignoreListFileInput = document.getElementById('ignore-list-file');
  const langSel = document.getElementById('language-select');

  if (!fileInput.files[0]) { flash('Please select an SRT file.', 'warning'); return; }

  currentLanguage = langSel.value;
  currentFilename = fileInput.files[0].name;
  currentSrtText = await fileInput.files[0].text();

  let ignoreListText = '';
  if (ignoreListFileInput.files[0]) {
    ignoreListText = await ignoreListFileInput.files[0].text();
  }

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  formData.append('language', currentLanguage);
  formData.append('ignore_list_text', ignoreListText);

  const btn = document.getElementById('btn-analyze');
  const spinner = document.getElementById('analyze-spinner');
  btn.disabled = true;
  spinner.classList.remove('d-none');

  try {
    const res = await fetch('/api/analyze', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) { flash(data.detail || 'Analysis failed.', 'danger'); return; }
    activeSessionId = null;
    renderResults(data.results, data.total_tokens);
    if (IS_LOGGED_IN) loadSessions();
  } catch (err) {
    flash('Network error: ' + err.message, 'danger');
  } finally {
    btn.disabled = false;
    spinner.classList.add('d-none');
  }
});

/* ── Render results ── */
function renderResults(results, totalTokens) {
  allResults = results;
  totalTokensCached = totalTokens;
  showingIgnored = false;
  buildVisibleIndices();
  updateSummary();

  const toggleBtn = document.getElementById('btn-toggle-ignored');
  if (toggleBtn) toggleBtn.innerHTML = '<i class="bi bi-eye-slash"></i> Show ignored';

  document.getElementById('results-section').classList.remove('d-none');

  const wrapper = document.querySelector('.results-table-wrapper');
  renderVirtual(wrapper?.scrollTop ?? 0, wrapper?.clientHeight || Math.floor(window.innerHeight * 0.6));
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ── Toggle ignored rows ── */
document.getElementById('btn-toggle-ignored')?.addEventListener('click', function () {
  showingIgnored = !showingIgnored;
  buildVisibleIndices();
  const wrapper = document.querySelector('.results-table-wrapper');
  wrapper.scrollTop = 0;
  renderVirtual(0, wrapper.clientHeight);
  this.innerHTML = showingIgnored
    ? '<i class="bi bi-eye"></i> Hide ignored'
    : '<i class="bi bi-eye-slash"></i> Show ignored';
});

/* ── Ignore list ── */
async function addToIgnoreList(word, btn) {
  if (!IS_LOGGED_IN) {
    new bootstrap.Modal(document.getElementById('login-modal')).show();
    return;
  }
  const res = await fetch('/api/ignorelist/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ word, language: currentLanguage }),
  });
  if (res.ok) {
    flash(`"${word}" added to ignore list.`);
    const item = allResults.find(r => r.lemma === word);
    if (item) item.ignored = true;
    buildVisibleIndices();
    updateSummary();
    const wrapper = document.querySelector('.results-table-wrapper');
    renderVirtual(wrapper.scrollTop, wrapper.clientHeight);
  } else {
    flash('Failed to add to ignore list.', 'danger');
  }
}

/* ── CSV export ── */
document.getElementById('btn-csv')?.addEventListener('click', () => {
  if (!allResults.length) return;
  const header = 'rank,lemma,frequency,ignored\n';
  const rows = allResults.map((r, i) => `${i + 1},"${r.lemma}",${r.frequency},${r.ignored}`).join('\n');
  const blob = new Blob(['\uFEFF' + header + rows], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (currentFilename || 'results').replace(/\.srt$/i, '') + '_freq.csv';
  a.click();
  URL.revokeObjectURL(url);
});

/* ── Save session ── */
document.getElementById('btn-save-session')?.addEventListener('click', async () => {
  if (!allResults.length) return;
  const name = `Session ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
  const res = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      language: currentLanguage,
      srt_filename: currentFilename,
      srt_content: currentSrtText,
      results: allResults,
    }),
  });
  if (res.ok) {
    const saved = await res.json();
    activeSessionId = saved.id;
    flash('Session saved!');
    loadSessions();
  } else {
    flash('Failed to save session.', 'danger');
  }
});

/* ── Export ignore list ── */
document.getElementById('btn-export-ignorelist')?.addEventListener('click', () => {
  window.location.href = `/api/ignorelist/export?language=${currentLanguage}`;
});

/* ── Column resize ── */
const COL_WIDTHS_KEY = 'subtitleAnalyzer.colWidths';

function applyColWidths() {
  const saved = localStorage.getItem(COL_WIDTHS_KEY);
  if (!saved) return;
  const widths = JSON.parse(saved);
  document.querySelectorAll('#results-table thead th').forEach((th, i) => {
    if (widths[i] != null) th.style.width = widths[i] + 'px';
  });
}

function saveColWidths() {
  const widths = [...document.querySelectorAll('#results-table thead th')].map(th => th.offsetWidth);
  localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(widths));
}

document.querySelectorAll('#results-table thead th .col-resize-handle').forEach(handle => {
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const th = handle.closest('th');
    const thLeft = th.getBoundingClientRect().left;
    handle.classList.add('resizing');

    const onMouseMove = (e) => {
      th.style.width = Math.max(40, e.clientX - thLeft) + 'px';
    };
    const onMouseUp = () => {
      handle.classList.remove('resizing');
      saveColWidths();
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
});

applyColWidths();

/* ── Init ── */
document.querySelector('.results-table-wrapper')?.addEventListener('scroll', function () {
  renderVirtual(this.scrollTop, this.clientHeight);
});

if (IS_LOGGED_IN) loadSessions();
