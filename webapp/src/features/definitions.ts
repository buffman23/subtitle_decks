/* ── Word definitions, shared by the desktop definition card and the mobile
   Definition tab. Definitions come from Wiktionary via /api/definitions;
   Arabic lemmas Wiktionary lacks fall back to camel_tools' own glosses from
   the session's subtitle segments. ── */
import type { DefinitionEntry, DefinitionsResponse } from '../types';
import { state } from '../state';
import { posLabel } from '../ui/pos';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

type Source = 'wiktionary' | 'model';
interface Definitions { entries: DefinitionEntry[]; source: Source; }

// Definitions shown per POS before the "Show more" toggle.
const SHOWN_PER_POS = 5;

// language|lemma -> definitions (the promise, so concurrent opens share a fetch)
const cache = new Map<string, Promise<Definitions>>();

/** camel_tools glosses for an Arabic lemma, grouped by its tagged POS. */
function modelGlosses(lemma: string): DefinitionEntry[] {
  const byPos = new Map<string, string[]>();
  for (const sub of state.parsedSubtitles) {
    for (const seg of sub.segments ?? []) {
      const gloss = seg.lemma === lemma ? seg.analysis?.gloss : undefined;
      if (!gloss) continue;
      const pos = seg.analysis?.pos ? posLabel(seg.analysis.pos) : 'Other';
      let defs = byPos.get(pos);
      if (!defs) byPos.set(pos, defs = []);
      for (const part of gloss.replace(/_\[CALIMA\]/g, '').split(';')) {
        const text = part.replace(/_/g, ' ').trim();
        if (text && !defs.includes(text)) defs.push(text);
      }
    }
  }
  return [...byPos].map(([pos, definitions]) => ({ pos, definitions }));
}

async function fetchDefinitions(language: string, lemma: string): Promise<Definitions> {
  const res = await fetch(`/api/definitions/${encodeURIComponent(language)}?lemma=${encodeURIComponent(lemma)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as DefinitionsResponse;
  if (!data.entries.length && language.startsWith('ar-')) {
    return { entries: modelGlosses(lemma), source: 'model' };
  }
  return { entries: data.entries, source: 'wiktionary' };
}

function getDefinitions(lemma: string): Promise<Definitions> {
  const key = `${state.currentLanguage}|${lemma}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = fetchDefinitions(state.currentLanguage, lemma);
    // Don't keep failures: the next open retries.
    pending.catch(() => cache.delete(key));
    cache.set(key, pending);
  }
  return pending;
}

/* Put the POS the processor tagged this lemma with first: an exact label match
   ranks above a containing one (e.g. "Comparative adjective" ⊃ "Adjective"). */
function sortByTaggedPos(entries: DefinitionEntry[], lemma: string): DefinitionEntry[] {
  const top = state.posByLemma.get(lemma)?.top.toLowerCase();
  if (!top) return entries;
  const rank = (pos: string) => {
    const p = pos.toLowerCase();
    return p === top ? 0 : top.includes(p) ? 1 : 2;
  };
  return [...entries].sort((a, b) => rank(a.pos) - rank(b.pos));
}

function entriesHtml(defs: Definitions, lemma: string): string {
  if (!defs.entries.length) return '<p class="definition-empty">No definition found.</p>';
  let html = '';
  for (const { pos, definitions } of sortByTaggedPos(defs.entries, lemma)) {
    const items = definitions.map((d, i) =>
      `<li${i >= SHOWN_PER_POS ? ' class="definition-extra" hidden' : ''}>${escapeHtml(d)}</li>`).join('');
    const more = definitions.length - SHOWN_PER_POS;
    html += `<section class="definition-pos">
        <h6 class="definition-pos-label">${escapeHtml(pos)}</h6>
        <ol class="definition-list">${items}</ol>
        ${more > 0 ? `<button type="button" class="btn btn-link btn-sm p-0 definition-more">Show ${more} more</button>` : ''}
      </section>`;
  }
  html += defs.source === 'model'
    ? '<p class="definition-credit">Model gloss (CAMeL Tools); not in Wiktionary</p>'
    : '<p class="definition-credit">From <a href="https://en.wiktionary.org/" target="_blank" rel="noopener">Wiktionary</a> (CC BY-SA)</p>';
  return html;
}

/* Render a lemma's definitions into `container`, which is reused across calls:
   a render that finishes after a newer one started is dropped. */
const renderTokens = new WeakMap<HTMLElement, number>();
let nextToken = 0;

export async function renderDefinitions(container: HTMLElement, lemma: string): Promise<void> {
  const token = ++nextToken;
  renderTokens.set(container, token);
  container.innerHTML = '<p class="definition-loading text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Loading definitions…</p>';
  let html: string;
  try {
    html = entriesHtml(await getDefinitions(lemma), lemma);
  } catch {
    html = '<p class="definition-empty">Couldn\'t load definitions. Try again later.</p>';
  }
  if (renderTokens.get(container) === token) container.innerHTML = html;
}

/** Wire the "Show N more" toggles inside a definitions container. */
export function initDefinitionsContainer(container: HTMLElement): void {
  container.addEventListener('click', e => {
    const btn = (e.target as Element).closest<HTMLButtonElement>('.definition-more');
    if (!btn) return;
    btn.closest('.definition-pos')?.querySelectorAll<HTMLElement>('.definition-extra')
      .forEach(li => { li.hidden = false; });
    btn.remove();
  });
}

/* ── Mobile Definition tab (#definition-panel) ── */
let panelLemma: string | null = null;

/** Fill the Definition tab for `lemma` (or its empty state when null). */
export function showDefinitionPanel(lemma: string | null): void {
  const title = document.getElementById('definition-panel-title');
  const body = document.getElementById('definition-panel-body');
  if (!title || !body) return;
  if (lemma === panelLemma && lemma !== null) return;
  panelLemma = lemma;
  if (lemma === null) {
    title.textContent = 'Definition';
    body.innerHTML = '<p class="definition-empty">Tap a word in the list to see its definition.</p>';
    return;
  }
  title.textContent = lemma;
  void renderDefinitions(body, lemma);
}
