import { state } from '../state';
import { flash } from '../ui/flash';
import { renderResults } from '../ui/virtualScroll';
import { resetUpload, viewPendingAnalysis, cancelPendingAnalysis } from './analyze';
import { getNativeSubtitles, restoreNativeSubtitles } from './subtitleViewer';
import { renderShareControls } from './sharing';
import { onMobileSessionShown } from './mobileTabs';

let _onAnalysisComplete: (() => void) | null = null;

export function registerSessionAnalysisCompleteHandler(fn: () => void): void {
  _onAnalysisComplete = fn;
}

function langAbbr(code: string): string {
  const parts = code.split('-');
  return parts[parts.length - 1].toUpperCase();
}

interface SessionListItem {
  id: number;
  name: string;
  language: string;
  owned?: boolean;
  owner_email?: string | null;
  is_default?: boolean;
  is_demo?: boolean;
}

/**
 * Build a sidebar row for one session. The per-session actions (rename for
 * owned sessions, delete/remove for both) live behind a meatballs (⋯) menu so
 * tapping the row body always just opens the session.
 */
function buildSessionItem(s: SessionListItem): HTMLElement {
  const owned = s.owned !== false;
  const item = document.createElement('div');
  item.className = 'session-item' + (s.id === state.activeSessionId ? ' active' : '');
  item.dataset['id'] = String(s.id);
  const title = (DEMO_MODE || owned) ? s.name : `${s.name} — shared by ${s.owner_email ?? 'someone'}`;
  // In demo mode the only per-session action is the admin "Remove from demo";
  // for anonymous / non-admin visitors there's nothing to do, so drop the menu.
  const showMenu = DEMO_MODE ? IS_ADMIN : true;
  const menuBtn = showMenu
    ? `<button class="btn btn-sm btn-link text-secondary btn-menu flex-shrink-0" title="More actions" aria-label="More actions">
      <i class="bi bi-three-dots"></i>
    </button>`
    : '';
  // Admin-only star marking the session the demo page auto-opens by default.
  const defaultStar = DEMO_MODE && IS_ADMIN && s.is_default
    ? `<i class="bi bi-star-fill text-warning flex-shrink-0" style="font-size:0.7rem" title="Default demo session"></i>`
    : '';
  // In the main app, mark sessions that are featured on the public /demo page.
  const demoIcon = !DEMO_MODE && s.is_demo
    ? `<i class="bi bi-easel text-secondary flex-shrink-0" style="font-size:0.8rem" title="Featured on the demo page"></i>`
    : '';
  item.innerHTML = `
    <div class="d-flex align-items-center gap-1 flex-grow-1 min-width-0">
      <span class="text-truncate session-name" title="${title}">${s.name}</span>
      ${defaultStar}
      <span class="badge bg-secondary fw-normal flex-shrink-0" style="font-size:0.6rem">${langAbbr(s.language)}</span>
      ${demoIcon}
    </div>
    ${menuBtn}`;
  item.addEventListener('click', (e) => {
    const menuBtn = (e.target as Element).closest('.btn-menu');
    if (menuBtn) {
      e.stopPropagation();
      openSessionMenu(menuBtn as HTMLElement, item, s, owned);
    } else {
      openSession(s.id);
    }
  });
  return item;
}

interface SessionMenuItem {
  icon: string;
  label: string;
  danger?: boolean;
  action: () => void;
}

let activeMenu: HTMLElement | null = null;
let activeMenuBtn: HTMLElement | null = null;

function closeSessionMenu(): void {
  activeMenu?.remove();
  activeMenu = null;
  activeMenuBtn?.classList.remove('menu-open');
  activeMenuBtn = null;
  document.removeEventListener('click', onMenuOutsideClick, true);
  document.removeEventListener('scroll', closeSessionMenu, true);
  window.removeEventListener('resize', closeSessionMenu);
}

function onMenuOutsideClick(e: Event): void {
  if (activeMenu && !activeMenu.contains(e.target as Node)) closeSessionMenu();
}

/**
 * Pop up the per-session action menu anchored under the meatballs button. The
 * menu is attached to <body> (not the row) so the sidebar's vertical scroll
 * can't clip it, and it flips above the button if it would overflow the
 * viewport bottom.
 */
function openSessionMenu(anchor: HTMLElement, item: HTMLElement, s: SessionListItem, owned: boolean): void {
  const wasOpenForThis = activeMenuBtn === anchor;
  closeSessionMenu();
  if (wasOpenForThis) return;  // second click on the same button: just close

  const entries: SessionMenuItem[] = [];
  if (DEMO_MODE) {
    // The demo list is public; the actions here are admin-only: pick which
    // session the page auto-opens, and unfeature a session.
    if (!s.is_default) {
      entries.push({
        icon: 'bi-star',
        label: 'Set as default',
        action: () => setDefaultDemo(s.id),
      });
    }
    entries.push({
      icon: 'bi-easel',
      label: 'Remove from demo',
      danger: true,
      action: () => removeFromDemo(s.id),
    });
  } else {
    if (owned) {
      entries.push({ icon: 'bi-pencil', label: 'Rename', action: () => startRename(item, s.id, s.name) });
    } else {
      entries.push({
        icon: 'bi-info-circle',
        label: 'Owner',
        action: () => showOwnerCard(anchor, s.owner_email ?? 'someone'),
      });
    }
    // Admins can feature any session on the public /demo page (toggles based on
    // whether it's already featured).
    if (IS_ADMIN) {
      entries.push(s.is_demo
        ? { icon: 'bi-easel', label: 'Remove from demo page', action: () => removeFromDemo(s.id) }
        : { icon: 'bi-easel', label: 'Add to demo', action: () => addToDemo(s.id) });
    }
    entries.push({
      icon: 'bi-trash3',
      label: owned ? 'Delete' : 'Remove',
      danger: true,
      action: () => deleteSession(s.id, owned),
    });
  }

  const menu = document.createElement('div');
  menu.className = 'session-menu';
  for (const entry of entries) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'session-menu-item' + (entry.danger ? ' danger' : '');
    btn.innerHTML = `<i class="bi ${entry.icon}"></i><span>${entry.label}</span>`;
    btn.addEventListener('click', () => { closeSessionMenu(); entry.action(); });
    menu.appendChild(btn);
  }
  document.body.appendChild(menu);

  const r = anchor.getBoundingClientRect();
  // Right-align the menu to the button; flip above if it would clip the bottom.
  menu.style.left = `${Math.max(8, r.right - menu.offsetWidth)}px`;
  menu.style.top = r.bottom + 4 + menu.offsetHeight > window.innerHeight
    ? `${r.top - 4 - menu.offsetHeight}px`
    : `${r.bottom + 4}px`;

  activeMenu = menu;
  activeMenuBtn = anchor;
  anchor.classList.add('menu-open');
  // Defer listener registration so this same click doesn't immediately close it.
  setTimeout(() => {
    document.addEventListener('click', onMenuOutsideClick, true);
    document.addEventListener('scroll', closeSessionMenu, true);
    window.addEventListener('resize', closeSessionMenu);
  }, 0);
}

let activeCard: HTMLElement | null = null;

function closeOwnerCard(): void {
  activeCard?.remove();
  activeCard = null;
  document.removeEventListener('click', onCardOutsideClick, true);
  document.removeEventListener('keydown', onCardKeydown, true);
  document.removeEventListener('scroll', closeOwnerCard, true);
  window.removeEventListener('resize', closeOwnerCard);
}

function onCardOutsideClick(e: Event): void {
  if (activeCard && !activeCard.contains(e.target as Node)) closeOwnerCard();
}

function onCardKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeOwnerCard();
}

/**
 * Pop up a small dismissable card showing who shared a session. Dismissable by
 * the × button, clicking anywhere outside, pressing Escape, or scrolling.
 */
function showOwnerCard(anchor: HTMLElement, email: string): void {
  closeOwnerCard();
  const card = document.createElement('div');
  card.className = 'session-owner-card';
  card.innerHTML = `
    <button type="button" class="session-owner-card-close" aria-label="Dismiss">
      <i class="bi bi-x-lg"></i>
    </button>
    <div class="session-owner-card-label">Shared by</div>
    <div class="session-owner-card-email"></div>`;
  (card.querySelector('.session-owner-card-email') as HTMLElement).textContent = email;
  card.querySelector('.session-owner-card-close')!.addEventListener('click', closeOwnerCard);
  document.body.appendChild(card);

  const r = anchor.getBoundingClientRect();
  // Right-align to the button, clamped to the viewport; flip above if it would
  // overflow the bottom.
  const left = Math.min(r.right - card.offsetWidth, window.innerWidth - card.offsetWidth - 8);
  card.style.left = `${Math.max(8, left)}px`;
  card.style.top = r.bottom + 4 + card.offsetHeight > window.innerHeight
    ? `${r.top - 4 - card.offsetHeight}px`
    : `${r.bottom + 4}px`;

  activeCard = card;
  setTimeout(() => {
    document.addEventListener('click', onCardOutsideClick, true);
    document.addEventListener('keydown', onCardKeydown, true);
    document.addEventListener('scroll', closeOwnerCard, true);
    window.addEventListener('resize', closeOwnerCard);
  }, 0);
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
        onMobileSessionShown();
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

function toggleDemoEmpty(show: boolean): void {
  const empty = document.getElementById('demo-empty');
  if (!empty) return;
  empty.classList.toggle('d-none', !show);
  empty.classList.toggle('d-flex', show);
}

async function loadDemoSessions(): Promise<void> {
  const list = document.getElementById('session-list');
  if (!list) return;
  try {
    const res = await fetch('/api/demo/sessions');
    if (!res.ok) { list.innerHTML = '<div class="text-danger small text-center mt-3">Failed to load demo sessions</div>'; return; }
    const sessions: SessionListItem[] = await res.json();
    if (sessions.length === 0) {
      list.innerHTML = '<div class="text-muted small text-center mt-3">No demo sessions yet</div>';
      // Nothing to auto-open: show the main-area placeholder instead of a blank page.
      if (state.activeSessionId == null) toggleDemoEmpty(true);
      return;
    }
    toggleDemoEmpty(false);
    list.innerHTML = '';
    sessions.forEach(s => list.appendChild(buildSessionItem(s)));
    // Auto-open a session so the visitor sees results immediately — the pinned
    // default if there is one, otherwise the first (newest) row. Only when
    // nothing is open yet, so a reload (e.g. after Set as default) doesn't yank
    // an admin away from the session they're viewing.
    if (state.activeSessionId == null) {
      const target = sessions.find(s => s.is_default) ?? sessions[0];
      void openSession(target.id);
    }
  } catch (_e) {
    list.innerHTML = '<div class="text-danger small text-center mt-3">Failed to load demo sessions</div>';
  }
}

export async function loadSessions(): Promise<void> {
  closeSessionMenu();  // the list is about to be rebuilt; drop any open menu
  closeOwnerCard();
  if (DEMO_MODE) { await loadDemoSessions(); return; }
  if (!IS_LOGGED_IN) { renderPending(); return; }
  const list = document.getElementById('session-list');
  if (!list) return;
  try {
    const res = await fetch('/api/sessions');
    if (!res.ok) { renderPending(); return; }
    const sessions: SessionListItem[] = await res.json();
    const owned = sessions.filter(s => s.owned !== false);
    const shared = sessions.filter(s => s.owned === false);
    if (sessions.length === 0) {
      list.innerHTML = '<div class="text-muted small text-center mt-3">No saved sessions</div>';
      renderPending();
      return;
    }
    list.innerHTML = '';
    owned.forEach(s => list.appendChild(buildSessionItem(s)));
    if (shared.length > 0) {
      const header = document.createElement('div');
      header.className = 'session-section-header';
      header.innerHTML = `
        <i class="bi bi-people-fill"></i>
        <span>Shared with me</span>
        <span class="rule"></span>`;
      list.appendChild(header);
      shared.forEach(s => list.appendChild(buildSessionItem(s)));
    }
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
  // The input lives inside the .session-item row, whose click handler opens the
  // session. Without this, clicking into the field to move the cursor bubbles up
  // and reloads the sidebar, wiping out the edit before you can type.
  input.addEventListener('click', (e) => e.stopPropagation());

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

export async function openSession(id: number): Promise<void> {
  const res = await fetch(DEMO_MODE ? `/api/demo/sessions/${id}` : `/api/sessions/${id}`);
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
  state.activeSessionOwned = session.owned !== false;

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
  renderShareControls(id, session.owned !== false, session.shared_with ?? [], session.is_demo === true);
  if (_onAnalysisComplete) _onAnalysisComplete();
  restoreNativeSubtitles(Array.isArray(session.native_subtitles) && session.native_subtitles.length > 0
    ? session.native_subtitles : []);
  loadSessions();
}

async function deleteSession(id: number, owned: boolean = true): Promise<void> {
  const msg = owned
    ? 'Delete this session?'
    : 'Remove this shared session? It stays available to the owner.';
  if (!confirm(msg)) return;
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

async function addToDemo(id: number): Promise<void> {
  const res = await fetch(`/api/sessions/${id}/demo`, { method: 'POST' });
  if (res.ok) {
    flash('Added to the demo page.', 'success');
    loadSessions();  // refresh so the menu now offers "Remove from demo"
  } else {
    flash('Failed to add to demo page.', 'danger');
  }
}

async function removeFromDemo(id: number): Promise<void> {
  if (!confirm('Remove this session from the demo page?')) return;
  const res = await fetch(`/api/sessions/${id}/demo`, { method: 'DELETE' });
  if (res.ok) {
    // On the public /demo page the removed session is what's on screen, so drop
    // the open view — loadSessions() then auto-opens the next demo session (or
    // the empty-state placeholder). In the main app, unfeaturing a session must
    // not close the session the admin is currently viewing.
    if (DEMO_MODE && state.activeSessionId === id) {
      state.activeSessionId = null;
      document.getElementById('results-section')?.classList.add('d-none');
    }
    loadSessions();
  } else {
    flash('Failed to remove from demo page.', 'danger');
  }
}

async function setDefaultDemo(id: number): Promise<void> {
  const res = await fetch(`/api/sessions/${id}/demo/default`, { method: 'POST' });
  if (res.ok) {
    flash('Set as the default demo session.', 'success');
    loadSessions();  // refresh the star indicator on the rows
  } else {
    flash('Failed to set default demo session.', 'danger');
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
        state.activeSessionOwned = true;
        renderShareControls(saved.id, true, []);
        flash('Session saved!');
      }
    } catch (_) { /* corrupt storage — silently discard */ }
  }
  loadSessions();
}

export function initSessions(): void {
  document.getElementById('btn-new-session')?.addEventListener('click', () => {
    // On the demo page, starting a new analysis means leaving it for the normal app.
    if (DEMO_MODE) { window.location.href = '/'; return; }
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
    // On mobile the upload form lives behind the Words tab.
    onMobileSessionShown();
  });
}
