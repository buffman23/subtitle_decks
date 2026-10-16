/* Card-creation wizard (cards.html). Steps: 0 = deck name, then one step per
   selected word. All progress lives in the session's card draft on the server
   (/api/anki/drafts/<session>) and is saved as the user goes, so leaving and
   coming back via "Create Cards" resumes where they left off. */
import type { SubtitleEntry } from './types';
import { state } from './state';
import { flash } from './ui/flash';
import { buildPosIndex } from './ui/pos';
import { getDefinitions, sortByTaggedPos } from './features/definitions';
import { findOverlapping, lemmaHits, type LemmaHit } from './lib/subtitles';
import { escapeHtml } from './lib/html';
import { renderBack, wireAudioButtons, playAudio, type CardMedia } from './lib/cardRender';

interface MediaRef { id: string; name: string; mime: string; }
interface DraftCard {
  word: string;
  native: string;
  example_foreign: string;
  example_native: string;
  example_sub_index: number | null;  // position in the foreign subtitles
  native_sub_index: number | null;   // first native line, when moved by hand
  image: MediaRef | null;
  audio: MediaRef | null;
}
interface Draft {
  selected_lemmas: string[];
  deck_name: string | null;
  current_step: number;
  cards: Record<string, DraftCard>;
}
interface DeckInfo { name: string; total: number; }

const root = document.getElementById('cards-app') as HTMLElement;
const sessionId = Number(root.dataset['sessionId']);
const sessionUrl = `/?session=${sessionId}`;
const draftUrl = `/api/anki/drafts/${sessionId}`;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let draft: Draft;
let decks: DeckInfo[] = [];
let subs: SubtitleEntry[] = [];
let nativeSubs: SubtitleEntry[] = [];
let step = 0;
let finished = false;

// Example picker position for the current card.
let hits: LemmaHit[] = [];
let exPos = 0;           // foreign subtitle shown
let nativeStart = 0;     // first native line shown
let nativeCount = 0;     // number of native lines shown

const lemmas = () => draft.selected_lemmas;
const lastStep = () => lemmas().length;
const currentLemma = () => lemmas()[step - 1];
const mediaUrl = (ref: MediaRef | null) => ref ? `${draftUrl}/media/${ref.id}` : null;
const player = $<HTMLAudioElement>('card-audio-player');

function emptyCard(lemma: string): DraftCard {
  return {
    word: lemma, native: '', example_foreign: '', example_native: '',
    example_sub_index: null, native_sub_index: null, image: null, audio: null,
  };
}

/* ── Saving ───────────────────────────────────────────────────────────── */

let saveTimer: number | null = null;
let dirty = false;
let saveChain: Promise<boolean> = Promise.resolve(true);

function payload(): string {
  return JSON.stringify({ deck_name: draft.deck_name ?? '', current_step: step, cards: draft.cards });
}

function setSaveStatus(text: string): void {
  $('cards-save-status').textContent = text;
}

function markDirty(): void {
  dirty = true;
  setSaveStatus('Saving…');
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { void save(); }, 1500);
}

function save(): Promise<boolean> {
  if (finished) return Promise.resolve(true);
  if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null; }
  const body = payload();
  dirty = false;
  saveChain = saveChain.then(async () => {
    try {
      const res = await fetch(draftUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
      if (!res.ok) throw new Error(String(res.status));
      setSaveStatus('All changes saved');
      return true;
    } catch {
      dirty = true;
      setSaveStatus('Not saved — check your connection');
      return false;
    }
  });
  return saveChain;
}

// Leaving the page (tab close, back button, link): flush pending edits.
window.addEventListener('pagehide', () => {
  if (!dirty || finished) return;
  void fetch(draftUrl, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: payload(), keepalive: true,
  });
});

/* ── Steps ────────────────────────────────────────────────────────────── */

function showStep(n: number): void {
  step = Math.max(0, Math.min(n, lastStep()));
  $('step-deck').classList.toggle('d-none', step !== 0);
  $('step-card').classList.toggle('d-none', step === 0);
  $('cards-step-label').textContent = step === 0
    ? 'Choose a deck'
    : `Card ${step} of ${lastStep()}`;
  $('cards-progress').style.width = `${(step / lastStep()) * 100}%`;
  $<HTMLButtonElement>('cards-prev').disabled = step === 0;
  $('cards-next').innerHTML = step === lastStep()
    ? '<i class="bi bi-check2-circle"></i> Create deck'
    : 'Next <i class="bi bi-chevron-right"></i>';
  if (step === 0) renderDeckStep();
  else renderCardStep();
  window.scrollTo({ top: 0 });
}

async function go(delta: number): Promise<void> {
  if (step === 0 && delta > 0 && !validateDeck()) return;
  if (step === lastStep() && delta > 0) { await submit(); return; }
  showStep(step + delta);
  await save();
}

/* ── Step 0: deck ─────────────────────────────────────────────────────── */

function deckNameError(name: string): string | null {
  if (!name) return 'Enter a deck name.';
  if (name.length > 100) return 'Deck names are limited to 100 characters.';
  if (name.includes('::') || /["\\\x00-\x1f]/.test(name)) return 'Deck names cannot contain "::", quotes or backslashes.';
  return null;
}

function validateDeck(): boolean {
  const input = $<HTMLInputElement>('deck-name');
  const error = deckNameError(input.value.trim());
  input.classList.toggle('is-invalid', error !== null);
  $('deck-error').textContent = error ?? '';
  return error === null;
}

function updateDeckHint(): void {
  const name = $<HTMLInputElement>('deck-name').value.trim();
  const existing = decks.find(d => d.name === name);
  $('deck-hint').textContent = !name ? '' : existing
    ? `Adds to your existing deck "${name}" (${existing.total} cards).`
    : `Creates a new deck "${name}".`;
}

function renderDeckStep(): void {
  const input = $<HTMLInputElement>('deck-name');
  input.value = draft.deck_name ?? '';
  updateDeckHint();
  const n = lemmas().length;
  $('deck-word-count').textContent = `${n} word${n === 1 ? '' : 's'}`;
  $('deck-word-list').innerHTML = lemmas()
    .map(l => `<span class="badge text-bg-light border fw-normal fs-6" dir="auto">${escapeHtml(l)}</span>`).join('');
}

/* ── Card steps ───────────────────────────────────────────────────────── */

function currentCard(): DraftCard {
  const lemma = currentLemma();
  return (draft.cards[lemma] ??= emptyCard(lemma));
}

const FIELD_INPUTS: [string, keyof DraftCard][] = [
  ['card-word', 'word'],
  ['card-native', 'native'],
  ['card-example-foreign', 'example_foreign'],
  ['card-example-native', 'example_native'],
];

function renderCardStep(): void {
  const lemma = currentLemma();
  const firstVisit = !draft.cards[lemma];
  const card = currentCard();
  for (const [id, key] of FIELD_INPUTS) {
    const el = $<HTMLInputElement | HTMLTextAreaElement>(id);
    el.value = String(card[key] ?? '');
    el.classList.remove('is-invalid');
  }
  renderMedia();
  initExamplePicker(card);
  renderPreview();
  if (firstVisit) {
    markDirty();
    void prefillNative(lemma);
  }
}

// Wiktionary "form of" glosses ("gerund of haben", "plural of Haus") say
// nothing about meaning, so they're skipped when suggesting a translation.
const FORM_OF = /(form|plural|singular|gerund|participle|inflection|infinitive|tense|comparative|superlative|diminutive|feminine|masculine|genitive|dative|accusative|nominative|imperative|subjunctive|indicative|spelling|abbreviation|contraction) of/i;

// First meaningful Wiktionary definition (or Arabic model gloss) as the native word.
async function prefillNative(lemma: string): Promise<void> {
  const input = $<HTMLInputElement>('card-native');
  input.placeholder = 'Looking up a translation…';
  try {
    const defs = await getDefinitions(lemma);
    const all = sortByTaggedPos(defs.entries, lemma).flatMap(e => e.definitions);
    const first = all.find(d => !FORM_OF.test(d)) ?? all[0] ?? '';
    const suggestion = first.split(';')[0].trim();
    const card = draft.cards[lemma];
    if (card && !card.native && suggestion) {
      card.native = suggestion;
      if (currentLemma() === lemma) { input.value = suggestion; renderPreview(); }
      markDirty();
    }
  } catch { /* leave it for the user to fill in */ }
  if (currentLemma() === lemma) input.placeholder = '';
}

function renderPreview(): void {
  const card = currentCard();
  const media: CardMedia = { imageUrl: mediaUrl(card.image), audioUrl: mediaUrl(card.audio) };
  $('preview-forward').innerHTML = renderBack(card, media, 0);
  $('preview-reverse').innerHTML = renderBack(card, media, 1);
  $('card-word-play').classList.toggle('d-none', !card.audio);
}

/* ── Example picker ───────────────────────────────────────────────────── */

function initExamplePicker(card: DraftCard): void {
  hits = lemmaHits(subs, currentLemma());
  exPos = card.example_sub_index ?? hits[0]?.pos ?? 0;
  alignNative(card.native_sub_index);
  renderExample();
}

// Native lines overlapping the current foreign line; `start` keeps a
// hand-picked position (its window keeps the overlap's line count).
function alignNative(start: number | null): void {
  const sub = subs[exPos];
  if (!sub || !nativeSubs.length) { nativeStart = 0; nativeCount = 0; return; }
  const matches = findOverlapping(sub, nativeSubs);
  nativeCount = Math.max(1, matches.length);
  nativeStart = start ?? Math.max(0, nativeSubs.indexOf(matches[0]));
  nativeStart = Math.min(nativeStart, nativeSubs.length - 1);
}

function highlightLine(sub: SubtitleEntry, lemma: string): string {
  const segs = sub.segments.filter(s => s.lemma === lemma).sort((a, b) => a.start - b.start);
  let html = '', at = 0;
  for (const s of segs) {
    if (s.start < at) continue;
    html += escapeHtml(sub.text.slice(at, s.start))
      + `<mark>${escapeHtml(sub.text.slice(s.start, s.start + s.length))}</mark>`;
    at = s.start + s.length;
  }
  return (html + escapeHtml(sub.text.slice(at))).replace(/\n/g, '<br>');
}

function nativeLines(): SubtitleEntry[] {
  return nativeSubs.slice(nativeStart, nativeStart + nativeCount);
}

function renderExample(): void {
  const sub = subs[exPos];
  $('ex-foreign').innerHTML = sub ? highlightLine(sub, currentLemma()) : '<span class="text-muted">No subtitles.</span>';
  $('ex-time').textContent = sub ? sub.start_time.replace(/,\d+$/, '') : '';
  const occ = hits.findIndex(h => h.pos === exPos);
  $('ex-occ-label').textContent = hits.length
    ? (occ >= 0 ? `${occ + 1} / ${hits.length}` : `– / ${hits.length}`)
    : 'not found';
  $<HTMLButtonElement>('ex-occ-prev').disabled = !hits.some(h => h.pos < exPos);
  $<HTMLButtonElement>('ex-occ-next').disabled = !hits.some(h => h.pos > exPos);
  $<HTMLButtonElement>('ex-line-prev').disabled = exPos <= 0;
  $<HTMLButtonElement>('ex-line-next').disabled = exPos >= subs.length - 1;

  const hasNative = nativeSubs.length > 0;
  $('ex-native-wrap').classList.toggle('d-none', !hasNative);
  $('ex-no-native').classList.toggle('d-none', hasNative);
  if (hasNative) {
    $('ex-native').innerHTML = nativeLines().map(s => escapeHtml(s.text).replace(/\n/g, '<br>')).join('<br>');
    $<HTMLButtonElement>('ex-native-prev').disabled = nativeStart <= 0;
    $<HTMLButtonElement>('ex-native-next').disabled = nativeStart + nativeCount >= nativeSubs.length;
  }
}

function moveForeign(pos: number): void {
  if (pos < 0 || pos >= subs.length) return;
  exPos = pos;
  alignNative(null);
  renderExample();
}

function stepOccurrence(dir: 1 | -1): void {
  const next = dir > 0
    ? hits.find(h => h.pos > exPos)
    : [...hits].reverse().find(h => h.pos < exPos);
  if (next) moveForeign(next.pos);
}

function useExample(): void {
  const sub = subs[exPos];
  if (!sub) return;
  const card = currentCard();
  card.example_foreign = sub.text.replace(/\n/g, ' ');
  card.example_native = nativeLines().map(s => s.text.replace(/\n/g, ' ')).join(' ');
  card.example_sub_index = exPos;
  const auto = findOverlapping(sub, nativeSubs)[0];
  card.native_sub_index = auto && nativeSubs.indexOf(auto) === nativeStart ? null : nativeStart;
  $<HTMLTextAreaElement>('card-example-foreign').value = card.example_foreign;
  $<HTMLTextAreaElement>('card-example-native').value = card.example_native;
  renderPreview();
  markDirty();
}

function clearExample(): void {
  const card = currentCard();
  card.example_foreign = '';
  card.example_native = '';
  card.example_sub_index = null;
  card.native_sub_index = null;
  $<HTMLTextAreaElement>('card-example-foreign').value = '';
  $<HTMLTextAreaElement>('card-example-native').value = '';
  renderPreview();
  markDirty();
}

/* ── Media ────────────────────────────────────────────────────────────── */

function renderMedia(): void {
  const card = currentCard();
  $('card-image-preview').classList.toggle('d-none', !card.image);
  if (card.image) $<HTMLImageElement>('card-image-img').src = mediaUrl(card.image)!;
  $('card-audio-preview').classList.toggle('d-none', !card.audio);
  $('card-audio-name').textContent = card.audio?.name ?? '';
}

async function uploadMedia(kind: 'image' | 'audio', input: HTMLInputElement): Promise<void> {
  const file = input.files?.[0];
  if (!file) return;
  const lemma = currentLemma();
  const form = new FormData();
  form.append('kind', kind);
  form.append('file', file);
  input.disabled = true;
  try {
    // The draft must exist server-side before media can attach to it.
    await save();
    const res = await fetch(`${draftUrl}/media`, { method: 'POST', body: form });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { flash(body.detail ?? `Could not upload the ${kind}.`, 'danger'); return; }
    const card = draft.cards[lemma];
    const old = card[kind];
    card[kind] = body as MediaRef;
    if (old) void fetch(`${draftUrl}/media/${old.id}`, { method: 'DELETE' });
    if (currentLemma() === lemma) { renderMedia(); renderPreview(); }
    await save();
  } finally {
    input.disabled = false;
    input.value = '';
  }
}

async function removeMedia(kind: 'image' | 'audio'): Promise<void> {
  const card = currentCard();
  const old = card[kind];
  if (!old) return;
  card[kind] = null;
  renderMedia();
  renderPreview();
  await save();
  void fetch(`${draftUrl}/media/${old.id}`, { method: 'DELETE' });
}

/* ── Submit / cancel ──────────────────────────────────────────────────── */

async function submit(): Promise<void> {
  const missing = lemmas().findIndex(l => !(draft.cards[l]?.native ?? '').trim() || !(draft.cards[l]?.word ?? l).trim());
  if (missing >= 0) {
    showStep(missing + 1);
    $('card-native').classList.add('is-invalid');
    flash(`Card ${missing + 1} needs a native word before the deck can be created.`, 'warning');
    return;
  }
  const btn = $<HTMLButtonElement>('cards-next');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Creating…';
  try {
    if (!await save()) { flash('Could not save your cards. Please try again.', 'danger'); return; }
    const res = await fetch(`${draftUrl}/submit`, { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = body.detail;
      if (detail && typeof detail === 'object' && detail.step) {
        showStep(detail.step);
        flash(detail.message, 'warning');
      } else {
        flash(typeof detail === 'string' ? detail : 'Could not create the deck.', 'danger');
      }
      return;
    }
    finished = true;
    showDone(body.deck, body.added, body.skipped);
  } finally {
    btn.disabled = false;
    if (!finished) showStep(step);
  }
}

function showDone(deck: string, added: number, skipped: number): void {
  for (const id of ['step-deck', 'step-card', 'cards-footer']) $(id).classList.add('d-none');
  $('step-done').classList.remove('d-none');
  $('cards-progress').style.width = '100%';
  $('cards-step-label').textContent = 'Done';
  $('done-title').textContent = `Deck "${deck}" is ready`;
  $('done-detail').textContent = `Added ${added} note${added === 1 ? '' : 's'} (${added * 2} cards)`
    + (skipped ? `; skipped ${skipped} word${skipped === 1 ? '' : 's'} already in the deck.` : '.');
  $<HTMLAnchorElement>('done-study').href = `/study?deck=${encodeURIComponent(deck)}`;
  $<HTMLAnchorElement>('done-back').href = sessionUrl;
}

async function cancel(): Promise<void> {
  if (!confirm('Cancel card creation? All card progress for this session will be discarded.')) return;
  finished = true;
  await fetch(draftUrl, { method: 'DELETE' });
  window.location.href = sessionUrl;
}

/* ── Wiring ───────────────────────────────────────────────────────────── */

function wire(): void {
  $('cards-next').addEventListener('click', () => { void go(1); });
  $('cards-prev').addEventListener('click', () => { void go(-1); });
  $('cards-cancel').addEventListener('click', () => { void cancel(); });
  const exit = $<HTMLAnchorElement>('cards-exit');
  exit.href = sessionUrl;
  exit.addEventListener('click', async e => {
    e.preventDefault();
    await save();
    window.location.href = sessionUrl;
  });

  const deckInput = $<HTMLInputElement>('deck-name');
  deckInput.addEventListener('input', () => {
    draft.deck_name = deckInput.value.trim();
    deckInput.classList.remove('is-invalid');
    updateDeckHint();
    markDirty();
  });

  for (const [id, key] of FIELD_INPUTS) {
    const el = $<HTMLInputElement | HTMLTextAreaElement>(id);
    el.addEventListener('input', () => {
      (currentCard() as unknown as Record<string, string>)[key] = el.value;
      if (key === 'native') el.classList.remove('is-invalid');
      renderPreview();
      markDirty();
    });
  }

  $('ex-occ-prev').addEventListener('click', () => stepOccurrence(-1));
  $('ex-occ-next').addEventListener('click', () => stepOccurrence(1));
  $('ex-line-prev').addEventListener('click', () => moveForeign(exPos - 1));
  $('ex-line-next').addEventListener('click', () => moveForeign(exPos + 1));
  $('ex-native-prev').addEventListener('click', () => { nativeStart = Math.max(0, nativeStart - 1); renderExample(); });
  $('ex-native-next').addEventListener('click', () => {
    nativeStart = Math.min(nativeSubs.length - nativeCount, nativeStart + 1);
    renderExample();
  });
  $('ex-use').addEventListener('click', useExample);
  $('ex-clear').addEventListener('click', clearExample);

  $('card-image-input').addEventListener('change', e => { void uploadMedia('image', e.target as HTMLInputElement); });
  $('card-audio-input').addEventListener('change', e => { void uploadMedia('audio', e.target as HTMLInputElement); });
  $('card-image-remove').addEventListener('click', () => { void removeMedia('image'); });
  $('card-audio-remove').addEventListener('click', () => { void removeMedia('audio'); });
  $('card-word-play').addEventListener('click', () => playAudio(player, mediaUrl(currentCard().audio) ?? ''));
  wireAudioButtons($('preview-forward'), player);
  wireAudioButtons($('preview-reverse'), player);
}

async function loadDecks(): Promise<void> {
  const res = await fetch('/api/anki/decks').catch(() => null);
  if (!res?.ok) { $('deck-anki-warning').classList.remove('d-none'); return; }
  decks = await res.json();
  $('deck-options').innerHTML = decks.map(d => `<option value="${escapeHtml(d.name)}"></option>`).join('');
  if (draft && step === 0) updateDeckHint();
}

async function init(): Promise<void> {
  // Existing decks only feed the name suggestions; don't hold the page for them.
  void loadDecks();
  const [sessionRes, draftRes] = await Promise.all([fetch(`/api/sessions/${sessionId}`), fetch(draftUrl)]);
  if (!sessionRes.ok || !draftRes.ok) {
    flash('Could not load this session.', 'danger');
    return;
  }
  const session = await sessionRes.json();
  const loaded: Draft | null = await draftRes.json();
  if (!loaded || !loaded.selected_lemmas.length) {
    window.location.replace(sessionUrl);
    return;
  }
  draft = loaded;
  draft.cards ??= {};
  draft.deck_name ??= session.name;

  // Shared modules (definitions, POS ranking) read the app state.
  subs = session.subtitles ?? [];
  nativeSubs = session.native_subtitles ?? [];
  state.currentLanguage = session.language;
  state.parsedSubtitles = subs;
  state.posByLemma = buildPosIndex(subs);

  wire();
  $('cards-loading').classList.add('d-none');
  $('cards-footer').classList.remove('d-none');
  showStep(draft.current_step);
}

void init();
