import { state } from '../state';
import { cardColumnEnabled, registerCardSelectHandler, renderTable } from '../ui/virtualScroll';
import { flash } from '../ui/flash';
import { closeFab } from './fab';

/* Word selection for card creation. Each analysis session has one card draft
   per user (server-side, /api/anki/drafts/<session>) holding the selection and
   any card-creation progress. Changing the selection once progress exists asks
   first, because the progress is then discarded. */

interface DraftSummary {
  selected_lemmas: string[];
  current_step: number;
  cards: Record<string, Record<string, unknown>>;
}

// True when the active session's draft has work worth warning about.
let hasProgress = false;
// Session whose draft has been loaded; selection changes wait for it, so a
// click can't slip past the progress warning or be overwritten by the load.
let loadedFor: number | null = null;
let saveTimer: number | null = null;
let savePromise: Promise<void> = Promise.resolve();

function draftHasProgress(d: DraftSummary | null): boolean {
  if (!d) return false;
  if (d.current_step > 0) return true;
  return Object.values(d.cards ?? {}).some(card =>
    Object.values(card).some(v => v !== null && v !== '' && v !== undefined));
}

export function updateCreateCardsButton(): void {
  const btn = document.getElementById('btn-create-cards') as HTMLButtonElement | null;
  const wrap = document.getElementById('create-cards-wrap');
  if (!btn || !wrap) return;
  const n = state.cardSelection.size;
  btn.disabled = n === 0;
  btn.classList.toggle('btn-primary', n > 0);
  btn.classList.toggle('btn-secondary', n === 0);
  const label = btn.querySelector('.btn-label');
  if (label) label.textContent = n > 0 ? `Create Cards (${n})` : 'Create Cards';
  wrap.title = n > 0 ? '' : 'Select at least one word in the table to create cards';
}

/** Restore the selection saved in a session's card draft (after openSession). */
export async function loadCardSelection(sessionId: number): Promise<void> {
  if (!cardColumnEnabled()) return;
  hasProgress = false;
  loadedFor = null;
  const res = await fetch(`/api/anki/drafts/${sessionId}`);
  if (!res.ok || state.activeSessionId !== sessionId) return;
  const draft: DraftSummary | null = await res.json();
  if (state.activeSessionId !== sessionId) return;  // user moved on meanwhile
  state.cardSelection = new Set(draft?.selected_lemmas ?? []);
  hasProgress = draftHasProgress(draft);
  loadedFor = sessionId;
  renderTable();
  updateCreateCardsButton();
}

/** Yes/No modal; resolves true only on Yes. */
function confirmReset(): Promise<boolean> {
  const el = document.getElementById('card-reset-modal');
  if (!el) return Promise.resolve(window.confirm(
    'Changing the word selection will clear your existing card creation progress. Continue?'));
  return new Promise(resolve => {
    const modal = bootstrap.Modal.getOrCreateInstance(el);
    let answer = false;
    const yes = document.getElementById('card-reset-yes')!;
    const onYes = () => { answer = true; modal.hide(); };
    yes.addEventListener('click', onYes, { once: true });
    el.addEventListener('hidden.bs.modal', () => {
      yes.removeEventListener('click', onYes);
      resolve(answer);
    }, { once: true });
    modal.show();
  });
}

function orderedSelection(): string[] {
  return state.allResults.filter(r => state.cardSelection.has(r.lemma)).map(r => r.lemma);
}

function scheduleSave(sessionId: number): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { void flushSave(sessionId); }, 400);
}

function flushSave(sessionId: number): Promise<void> {
  if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null; }
  const lemmas = orderedSelection();
  savePromise = savePromise.then(async () => {
    const res = await fetch(`/api/anki/drafts/${sessionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selected_lemmas: lemmas }),
    });
    if (!res.ok) flash('Could not save the word selection.', 'danger');
  });
  return savePromise;
}

async function onCardSelect(lemmas: string[], checked: boolean): Promise<void> {
  const sessionId = state.activeSessionId;
  if (sessionId == null || loadedFor !== sessionId) { renderTable(); return; }
  const changes = lemmas.some(l => state.cardSelection.has(l) !== checked);
  if (!changes) { renderTable(); return; }
  if (hasProgress) {
    if (!await confirmReset()) {
      renderTable();  // put the checkboxes back as they were
      return;
    }
    const res = await fetch(`/api/anki/drafts/${sessionId}`, { method: 'DELETE' });
    if (!res.ok) { flash('Could not clear card progress.', 'danger'); renderTable(); return; }
    hasProgress = false;
  }
  for (const l of lemmas) {
    if (checked) state.cardSelection.add(l);
    else state.cardSelection.delete(l);
  }
  renderTable();
  updateCreateCardsButton();
  scheduleSave(sessionId);
}

export function initCardSelection(): void {
  if (!cardColumnEnabled()) return;
  registerCardSelectHandler((lemmas, checked) => { void onCardSelect(lemmas, checked); });
  document.getElementById('btn-create-cards')?.addEventListener('click', async () => {
    closeFab();
    const sessionId = state.activeSessionId;
    if (sessionId == null || state.cardSelection.size === 0) return;
    await flushSave(sessionId);
    window.location.href = `/sessions/${sessionId}/cards`;
  });
  updateCreateCardsButton();
}
