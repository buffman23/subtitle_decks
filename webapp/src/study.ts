/* Study page (study.html): the user's Anki decks (subdecks of their email in
   the server's Anki collection) with study, edit, export and "send to my
   Anki" actions. Studying uses Anki's own scheduler through /api/anki/study. */
import { flash } from './ui/flash';
import { escapeHtml } from './lib/html';
import { renderFront, renderBack, wireAudioButtons, playAudio, type CardMedia, type CardOrd } from './lib/cardRender';

interface Deck { name: string; new: number; learn: number; review: number; total: number; }
interface Note {
  note_id: number;
  word: string;
  native: string;
  example_foreign: string;
  example_native: string;
  image: string | null;
  audio: string | null;
}
interface StudyCard extends Note { card_id: number; ord: CardOrd; queue: number; next_intervals: string[]; }
interface Counts { new: number; learn: number; review: number; }

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const deckParam = (deck: string) => `deck=${encodeURIComponent(deck)}`;
const mediaUrl = (name: string | null) => name ? `/api/anki/media/${encodeURIComponent(name)}` : null;
const media = (n: Note): CardMedia => ({ imageUrl: mediaUrl(n.image), audioUrl: mediaUrl(n.audio) });
const player = $<HTMLAudioElement>('study-audio');

async function errorText(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return typeof body.detail === 'string' ? body.detail : fallback;
}

/* ── Views ────────────────────────────────────────────────────────────── */

type View = 'decks' | 'study' | 'edit';

function showView(view: View, deck?: string): void {
  $('decks-view').classList.toggle('d-none', view !== 'decks');
  $('study-view').classList.toggle('d-none', view !== 'study');
  $('edit-view').classList.toggle('d-none', view !== 'edit');
  const url = new URL(window.location.href);
  url.search = view === 'decks' || !deck ? '' : `?${view === 'edit' ? 'edit' : 'deck'}=${encodeURIComponent(deck)}`;
  window.history.replaceState({}, '', url.toString());
  if (view === 'decks') void loadDecks();
}

/* ── Deck list ────────────────────────────────────────────────────────── */

let decks: Deck[] = [];

async function loadDecks(): Promise<void> {
  $('decks-loading').classList.remove('d-none');
  $('decks-error').classList.add('d-none');
  const res = await fetch('/api/anki/decks');
  $('decks-loading').classList.add('d-none');
  if (!res.ok) {
    $('decks-error').textContent = await errorText(res, 'Could not load your decks.');
    $('decks-error').classList.remove('d-none');
    $('decks-table').classList.add('d-none');
    return;
  }
  decks = await res.json();
  $('decks-empty').classList.toggle('d-none', decks.length > 0);
  $('decks-table').classList.toggle('d-none', decks.length === 0);
  $('decks-tbody').innerHTML = decks.map((d, i) => `
    <tr data-idx="${i}">
      <td class="fw-semibold text-break" dir="auto">${escapeHtml(d.name)}</td>
      <td class="text-end count-new">${d.new}</td>
      <td class="text-end count-learn">${d.learn}</td>
      <td class="text-end count-review">${d.review}</td>
      <td class="text-end text-muted">${d.total}</td>
      <td class="text-end text-nowrap">
        <button type="button" class="btn btn-sm btn-primary" data-action="study"><i class="bi bi-play-fill"></i> Study</button>
        <div class="btn-group">
          <!-- Fixed positioning lets the menu escape the table's scroll container,
               which would otherwise clip it on short tables / the last row. -->
          <button type="button" class="btn btn-sm btn-outline-secondary dropdown-toggle" data-bs-toggle="dropdown"
                  data-bs-popper-config='{"strategy":"fixed"}'
                  aria-expanded="false" aria-label="More actions"><i class="bi bi-three-dots"></i></button>
          <ul class="dropdown-menu dropdown-menu-end">
            <li><button class="dropdown-item" data-action="edit"><i class="bi bi-pencil me-2"></i>Edit cards</button></li>
            <li><button class="dropdown-item" data-action="export"><i class="bi bi-download me-2"></i>Export .apkg</button></li>
            <li><button class="dropdown-item" data-action="local"><i class="bi bi-pc-display me-2"></i>Send to my Anki…</button></li>
            <li><hr class="dropdown-divider"></li>
            <li><button class="dropdown-item text-danger" data-action="delete"><i class="bi bi-trash me-2"></i>Delete deck</button></li>
          </ul>
        </div>
      </td>
    </tr>`).join('');
}

async function deleteDeck(deck: string): Promise<void> {
  if (!confirm(`Delete the deck "${deck}" and all its cards? This cannot be undone.`)) return;
  const res = await fetch(`/api/anki/decks?${deckParam(deck)}`, { method: 'DELETE' });
  if (!res.ok) { flash(await errorText(res, 'Could not delete the deck.'), 'danger'); return; }
  flash(`Deleted "${deck}".`);
  void loadDecks();
}

async function exportDeck(deck: string): Promise<void> {
  flash('Preparing export…', 'info');
  const res = await fetch(`/api/anki/decks/export?${deckParam(deck)}`);
  if (!res.ok) { flash(await errorText(res, 'Could not export the deck.'), 'danger'); return; }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = `${deck.replace(/[^\w\- .]+/g, '_').trim() || 'deck'}.apkg`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Study ────────────────────────────────────────────────────────────── */

let studyDeck = '';
let current: StudyCard | null = null;
let revealed = false;
let answering = false;

function renderCounts(c: Counts, queue: number | null): void {
  // Like Anki, underline the count the current card is drawn from.
  const mark = (q: boolean) => q ? ' current' : '';
  $('study-counts').innerHTML =
    `<span class="count-new${mark(queue === 0)}">${c.new}</span> · `
    + `<span class="count-learn${mark(queue === 1 || queue === 3)}">${c.learn}</span> · `
    + `<span class="count-review${mark(queue === 2)}">${c.review}</span>`;
}

async function startStudy(deck: string): Promise<void> {
  studyDeck = deck;
  $('study-deck-name').textContent = deck;
  showView('study', deck);
  await nextCard();
}

async function nextCard(): Promise<void> {
  const res = await fetch(`/api/anki/study/next?${deckParam(studyDeck)}`);
  if (!res.ok) {
    flash(await errorText(res, 'Could not load the next card.'), 'danger');
    if (res.status === 404) showView('decks');
    return;
  }
  const body: { card: StudyCard | null; counts: Counts } = await res.json();
  current = body.card;
  revealed = false;
  renderCounts(body.counts, current?.queue ?? null);
  $('study-card-wrap').classList.toggle('d-none', !current);
  $('study-done').classList.toggle('d-none', !!current);
  if (!current) return;
  $('study-card').innerHTML = renderFront(current, media(current), current.ord);
  $('study-show').classList.remove('d-none');
  $('study-answers').classList.add('d-none');
  // Forward cards play the word's audio as they appear, as in Anki.
  if (current.ord === 0 && current.audio) playAudio(player, mediaUrl(current.audio)!);
}

function showAnswer(): void {
  if (!current || revealed) return;
  revealed = true;
  $('study-card').innerHTML = renderBack(current, media(current), current.ord);
  $('study-show').classList.add('d-none');
  $('study-answers').classList.remove('d-none');
  document.querySelectorAll<HTMLElement>('#study-answers .btn-answer').forEach((btn, i) => {
    btn.querySelector('.interval')!.textContent = current!.next_intervals[i] ?? '';
  });
  if (current.ord === 1 && current.audio) playAudio(player, mediaUrl(current.audio)!);
}

async function answer(ease: number): Promise<void> {
  if (!current || !revealed || answering) return;
  answering = true;
  try {
    const res = await fetch('/api/anki/study/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ card_id: current.card_id, ease }),
    });
    if (!res.ok) { flash(await errorText(res, 'Could not record the answer.'), 'danger'); return; }
    await nextCard();
  } finally {
    answering = false;
  }
}

document.addEventListener('keydown', e => {
  if ($('study-view').classList.contains('d-none') || !current) return;
  const target = e.target as Element;
  if (target.closest('input, textarea, select, [contenteditable]')) return;
  // A focused button already acts on Space/Enter by itself.
  if (target.closest('button') && (e.key === ' ' || e.key === 'Enter')) return;
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    if (revealed) void answer(3);
    else showAnswer();
  } else if (revealed && ['1', '2', '3', '4'].includes(e.key)) {
    e.preventDefault();
    void answer(Number(e.key));
  }
});

/* ── Edit ─────────────────────────────────────────────────────────────── */

let notes: Note[] = [];

const EDIT_FIELDS: [keyof Note, string, boolean][] = [
  ['word', 'Foreign word', false],
  ['native', 'Native word', false],
  ['example_foreign', 'Foreign example', true],
  ['example_native', 'Native example', true],
];

async function startEdit(deck: string): Promise<void> {
  $('edit-deck-name').textContent = deck;
  $<HTMLInputElement>('edit-filter').value = '';
  showView('edit', deck);
  $('edit-list').innerHTML = '<div class="text-center text-muted py-5"><span class="spinner-border spinner-border-sm me-2"></span>Loading cards…</div>';
  const res = await fetch(`/api/anki/decks/notes?${deckParam(deck)}`);
  if (!res.ok) {
    flash(await errorText(res, 'Could not load the cards.'), 'danger');
    showView('decks');
    return;
  }
  notes = await res.json();
  renderNotes();
}

function noteHtml(n: Note): string {
  const fields = EDIT_FIELDS.map(([key, label, multi]) => {
    const id = `note-${n.note_id}-${key}`;
    const value = escapeHtml(String(n[key] ?? ''));
    const input = multi
      ? `<textarea class="form-control form-control-sm" id="${id}" data-field="${key}" rows="2" dir="auto">${value}</textarea>`
      : `<input type="text" class="form-control form-control-sm" id="${id}" data-field="${key}" value="${value}" dir="auto">`;
    return `<div class="col-md-${multi ? 12 : 6}"><label class="form-label small mb-0" for="${id}">${label}</label>${input}</div>`;
  }).join('');
  const image = n.image
    ? `<img src="${mediaUrl(n.image)}" alt="" class="note-thumb">
       <button type="button" class="btn btn-sm btn-link text-danger p-0" data-action="remove-media" data-kind="image">Remove</button>`
    : '<span class="text-muted small">No image</span>';
  const audio = n.audio
    ? `<button type="button" class="anki-play btn btn-sm btn-outline-primary" data-audio="${mediaUrl(n.audio)}"><i class="bi bi-play-fill"></i> Play</button>
       <button type="button" class="btn btn-sm btn-link text-danger p-0" data-action="remove-media" data-kind="audio">Remove</button>`
    : '<span class="text-muted small">No audio</span>';
  return `
    <div class="card mb-2 note-card" data-note-id="${n.note_id}">
      <div class="card-body py-2">
        <div class="row g-2">${fields}</div>
        <div class="d-flex flex-wrap align-items-center gap-3 mt-2">
          <div class="d-flex align-items-center gap-2">
            <span class="small fw-semibold">Image</span>${image}
            <label class="btn btn-sm btn-outline-secondary mb-0">${n.image ? 'Replace' : 'Add'}
              <input type="file" hidden data-action="upload-media" data-kind="image" accept="image/jpeg,image/png,image/gif,image/webp"></label>
          </div>
          <div class="d-flex align-items-center gap-2">
            <span class="small fw-semibold">Audio</span>${audio}
            <label class="btn btn-sm btn-outline-secondary mb-0">${n.audio ? 'Replace' : 'Add'}
              <input type="file" hidden data-action="upload-media" data-kind="audio" accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,audio/wav,audio/webm"></label>
          </div>
          <div class="ms-auto d-flex gap-2">
            <button type="button" class="btn btn-sm btn-outline-danger" data-action="delete-note"><i class="bi bi-trash"></i> Delete</button>
            <button type="button" class="btn btn-sm btn-primary" data-action="save-note" disabled>Save</button>
          </div>
        </div>
      </div>
    </div>`;
}

function renderNotes(): void {
  const q = $<HTMLInputElement>('edit-filter').value.trim().toLowerCase();
  const shown = q ? notes.filter(n => `${n.word} ${n.native}`.toLowerCase().includes(q)) : notes;
  $('edit-list').innerHTML = shown.length
    ? shown.map(noteHtml).join('')
    : `<p class="text-center text-muted py-5">${notes.length ? 'No cards match.' : 'This deck is empty.'}</p>`;
}

// Re-render one note after a server update, keeping any unsaved text edits.
function replaceNote(updated: Note): void {
  notes = notes.map(n => n.note_id === updated.note_id ? updated : n);
  const el = document.querySelector<HTMLElement>(`.note-card[data-note-id="${updated.note_id}"]`);
  if (!el) return;
  const unsaved = !el.querySelector<HTMLButtonElement>('[data-action="save-note"]')!.disabled;
  const edits = new Map<string, string>();
  if (unsaved) {
    el.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-field]')
      .forEach(f => edits.set(f.dataset['field']!, f.value));
  }
  el.outerHTML = noteHtml(updated);
  if (!unsaved) return;
  const fresh = document.querySelector<HTMLElement>(`.note-card[data-note-id="${updated.note_id}"]`)!;
  fresh.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-field]')
    .forEach(f => { f.value = edits.get(f.dataset['field']!) ?? f.value; });
  fresh.querySelector<HTMLButtonElement>('[data-action="save-note"]')!.disabled = false;
}

async function saveNote(card: HTMLElement, id: number): Promise<void> {
  const payload: Record<string, string> = {};
  card.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-field]').forEach(el => {
    payload[el.dataset['field']!] = el.value;
  });
  const res = await fetch(`/api/anki/notes/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (!res.ok) { flash(await errorText(res, 'Could not save the card.'), 'danger'); return; }
  card.querySelector<HTMLButtonElement>('[data-action="save-note"]')!.disabled = true;
  replaceNote(await res.json());
  flash('Card saved.');
}

async function deleteNote(id: number): Promise<void> {
  if (!confirm('Delete this note and both of its cards?')) return;
  const res = await fetch(`/api/anki/notes/${id}`, { method: 'DELETE' });
  if (!res.ok) { flash(await errorText(res, 'Could not delete the card.'), 'danger'); return; }
  notes = notes.filter(n => n.note_id !== id);
  renderNotes();
}

async function uploadNoteMedia(id: number, kind: string, input: HTMLInputElement): Promise<void> {
  const file = input.files?.[0];
  if (!file) return;
  const form = new FormData();
  form.append('kind', kind);
  form.append('file', file);
  const res = await fetch(`/api/anki/notes/${id}/media`, { method: 'POST', body: form });
  if (!res.ok) { flash(await errorText(res, `Could not upload the ${kind}.`), 'danger'); return; }
  replaceNote(await res.json());
}

async function removeNoteMedia(id: number, kind: string): Promise<void> {
  const res = await fetch(`/api/anki/notes/${id}/media/${kind}`, { method: 'DELETE' });
  if (!res.ok) { flash(await errorText(res, `Could not remove the ${kind}.`), 'danger'); return; }
  replaceNote(await res.json());
}

/* ── Send to the user's own Anki (local AnkiConnect) ──────────────────── */

const LOCAL_ANKI = 'http://127.0.0.1:8765';
let localDeck = '';

async function localAnki(action: string, params: object = {}): Promise<any> {
  const key = $<HTMLInputElement>('local-anki-key').value;
  // A text/plain body keeps this a "simple" CORS request (no preflight).
  const res = await fetch(LOCAL_ANKI, {
    method: 'POST',
    body: JSON.stringify({ action, version: 6, params, ...(key ? { key } : {}) }),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error);
  return body.result;
}

function setLocalStatus(html: string, cls = ''): void {
  const el = $('local-anki-status');
  el.className = `small ${cls}`;
  el.innerHTML = html;
}

async function sendToLocalAnki(): Promise<void> {
  const btn = $<HTMLButtonElement>('local-anki-send');
  btn.disabled = true;
  try {
    setLocalStatus('<span class="spinner-border spinner-border-sm me-1"></span> Connecting to Anki…');
    let perm: { permission: string; requireApiKey?: boolean };
    try {
      perm = await localAnki('requestPermission');
    } catch {
      setLocalStatus('Could not reach Anki on this computer. Make sure Anki is open with the AnkiConnect add-on installed, then try again.', 'text-danger');
      return;
    }
    if (perm.permission !== 'granted') {
      setLocalStatus('Anki declined the connection. Click <strong>Connect &amp; send</strong> again and choose <strong>Yes</strong> in Anki.', 'text-danger');
      return;
    }
    if (perm.requireApiKey && !$<HTMLInputElement>('local-anki-key').value) {
      $('local-anki-key-wrap').classList.remove('d-none');
      setLocalStatus('Your AnkiConnect requires an API key. Enter it above and try again.', 'text-warning');
      return;
    }

    setLocalStatus('<span class="spinner-border spinner-border-sm me-1"></span> Downloading deck…');
    const res = await fetch(`/api/anki/decks/package?${deckParam(localDeck)}`);
    if (!res.ok) { setLocalStatus(escapeHtml(await errorText(res, 'Could not load the deck.')), 'text-danger'); return; }
    const pkg: { deck: string; model: { modelName: string }; notes: Record<string, string>[]; media: Record<string, string> } = await res.json();

    setLocalStatus('<span class="spinner-border spinner-border-sm me-1"></span> Copying into Anki…');
    const models: string[] = await localAnki('modelNames');
    if (!models.includes(pkg.model.modelName)) await localAnki('createModel', pkg.model);
    await localAnki('createDeck', { deck: pkg.deck });
    for (const [filename, data] of Object.entries(pkg.media)) {
      await localAnki('storeMediaFile', { filename, data });
    }
    const notesToAdd = pkg.notes.map(fields => ({
      deckName: pkg.deck,
      modelName: pkg.model.modelName,
      fields,
      tags: ['subtitle-decks'],
      options: { allowDuplicate: false, duplicateScope: 'deck' },
    }));
    const ok: boolean[] = notesToAdd.length ? await localAnki('canAddNotes', { notes: notesToAdd }) : [];
    const fresh = notesToAdd.filter((_, i) => ok[i]);
    if (fresh.length) await localAnki('addNotes', { notes: fresh });
    const skipped = notesToAdd.length - fresh.length;
    setLocalStatus(
      `<i class="bi bi-check-circle-fill text-success"></i> Added ${fresh.length} note${fresh.length === 1 ? '' : 's'} to `
      + `<strong>${escapeHtml(pkg.deck)}</strong> in your Anki`
      + (skipped ? ` (${skipped} already there).` : '.'),
    );
  } catch (err) {
    setLocalStatus(`Anki reported an error: ${escapeHtml(String((err as Error).message ?? err))}`, 'text-danger');
  } finally {
    btn.disabled = false;
  }
}

function openLocalAnki(deck: string): void {
  localDeck = deck;
  $('local-anki-deck').textContent = deck;
  setLocalStatus('');
  bootstrap.Modal.getOrCreateInstance($('local-anki-modal')).show();
}

/* ── Wiring ───────────────────────────────────────────────────────────── */

$('decks-refresh').addEventListener('click', () => { void loadDecks(); });
$('decks-tbody').addEventListener('click', e => {
  const btn = (e.target as Element).closest<HTMLElement>('[data-action]');
  const idx = btn?.closest<HTMLElement>('tr')?.dataset['idx'];
  if (!btn || idx == null) return;
  const deck = decks[Number(idx)].name;
  switch (btn.dataset['action']) {
    case 'study': void startStudy(deck); break;
    case 'edit': void startEdit(deck); break;
    case 'export': void exportDeck(deck); break;
    case 'local': openLocalAnki(deck); break;
    case 'delete': void deleteDeck(deck); break;
  }
});
document.querySelectorAll('.study-back').forEach(b => b.addEventListener('click', () => showView('decks')));

$('study-show').addEventListener('click', showAnswer);
$('study-answers').addEventListener('click', e => {
  const btn = (e.target as Element).closest<HTMLElement>('[data-ease]');
  if (btn) void answer(Number(btn.dataset['ease']));
});
wireAudioButtons($('study-card'), player);

$('edit-filter').addEventListener('input', renderNotes);
const editList = $('edit-list');
wireAudioButtons(editList, player);
editList.addEventListener('input', e => {
  const card = (e.target as Element).closest<HTMLElement>('.note-card');
  if ((e.target as HTMLElement).dataset['field'] && card) {
    card.querySelector<HTMLButtonElement>('[data-action="save-note"]')!.disabled = false;
  }
});
editList.addEventListener('click', e => {
  const btn = (e.target as Element).closest<HTMLElement>('button[data-action]');
  const card = btn?.closest<HTMLElement>('.note-card');
  if (!btn || !card) return;
  const id = Number(card.dataset['noteId']);
  if (btn.dataset['action'] === 'save-note') void saveNote(card, id);
  else if (btn.dataset['action'] === 'delete-note') void deleteNote(id);
  else if (btn.dataset['action'] === 'remove-media') void removeNoteMedia(id, btn.dataset['kind']!);
});
editList.addEventListener('change', e => {
  const input = e.target as HTMLInputElement;
  const card = input.closest<HTMLElement>('.note-card');
  if (input.dataset['action'] === 'upload-media' && card) {
    void uploadNoteMedia(Number(card.dataset['noteId']), input.dataset['kind']!, input);
  }
});

$('local-anki-send').addEventListener('click', () => { void sendToLocalAnki(); });

/* ── Start: /study, /study?deck=<name> (study it), /study?edit=<name> ── */
const params = new URLSearchParams(window.location.search);
if (params.get('deck')) void startStudy(params.get('deck')!);
else if (params.get('edit')) void startEdit(params.get('edit')!);
else showView('decks');
