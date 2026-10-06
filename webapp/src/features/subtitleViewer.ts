import type { SubtitleEntry, SubtitleSegment } from '../types';
import { state, buildVisibleIndices } from '../state';
import { escapeHtml, scrollTableToLemma, renderTable } from '../ui/virtualScroll';
import { showWordTooltip, hideWordTooltip, isWordTooltipAnchor } from '../ui/wordTooltip';
import { isMobileLayout } from './mobileTabs';

type DetectedLanguage = 'arabic' | 'latin' | 'unknown';

interface ViewportData {
  subtitles: SubtitleEntry[];
  lang: DetectedLanguage;
  isProcessed: boolean;
}

// Module-level state
let nativeSubtitles: SubtitleEntry[] = [];
let lemmaToSubtitles: Map<string, number[]> = new Map();
let selectedLemma: string | null = null;
let occurrenceList: number[] = [];
let currentOccurrenceIdx = 0;
let activeProcessedSubIdx: Set<number> = new Set();
let activeNativeSubIdx: Set<number> = new Set();
const viewports = new Map<string, ViewportData>();
// Mobile scroll-focus: the pane the user is currently scrolling by hand. Only
// the leader's scroll drives highlighting; the other pane follows it. Cleared
// on programmatic navigation so those scrolls don't re-pick the highlight.
let scrollLeader: string | null = null;

const PROCESSED_ID = 'subtitle-viewport-processed';
const NATIVE_ID = 'subtitle-viewport-native';

export function buildLemmaIndex(): void {
  lemmaToSubtitles.clear();
  for (const sub of state.parsedSubtitles) {
    const seen = new Set<string>();
    for (const seg of sub.segments) {
      if (!seen.has(seg.lemma)) {
        seen.add(seg.lemma);
        const arr = lemmaToSubtitles.get(seg.lemma) ?? [];
        arr.push(sub.index);
        lemmaToSubtitles.set(seg.lemma, arr);
      }
    }
  }
}

function renderProcessedText(text: string, segments: SubtitleSegment[]): string {
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  let result = '', pos = 0;
  for (const seg of sorted) {
    if (seg.start > pos) result += escapeHtml(text.slice(pos, seg.start));
    const surface = text.slice(seg.start, seg.start + seg.length);
    result += `<span class="sub-word" data-lemma="${escapeHtml(seg.lemma)}" data-seg-start="${seg.start}">${escapeHtml(surface)}</span>`;
    pos = seg.start + seg.length;
  }
  if (pos < text.length) result += escapeHtml(text.slice(pos));
  return result;
}

function renderNativeText(text: string): string {
  return escapeHtml(text);
}

function detectLanguage(subtitles: SubtitleEntry[]): DetectedLanguage {
  let ltr = 0, rtl = 0;
  for (const sub of subtitles.slice(0, 20)) {
    for (const ch of sub.text) {
      if (/[a-zA-Z]/.test(ch)) ltr++;
      else if (/[ا-ى]/.test(ch)) rtl++;
    }
  }
  if (rtl > ltr) return 'arabic';
  if (ltr > rtl) return 'latin';
  return 'unknown';
}

// Render every subtitle entry into the viewport in normal document flow. No
// virtualization: variable-height rows can't clip (natural layout grows to fit),
// and every line is real DOM so browser Ctrl+F finds it. Subtitle files top out
// around a couple thousand entries, well within what the browser renders fine.
function renderViewport(containerId: string): void {
  const data = viewports.get(containerId);
  const container = document.getElementById(containerId);
  if (!data || !container) return;

  const { subtitles, lang, isProcessed } = data;
  const isRtl = lang === 'arabic';

  let html = '';
  for (const sub of subtitles) {
    const textHtml = isProcessed
      ? renderProcessedText(sub.text, sub.segments)
      : renderNativeText(sub.text);
    html += `<div class="subtitle-entry" id="${containerId}-sub-${sub.index}">`
      + `<div class="sub-number">${sub.index}</div>`
      + `<div class="sub-time">${escapeHtml(sub.start_time)} → ${escapeHtml(sub.end_time)}</div>`
      + `<div class="sub-text"${isRtl ? ' dir="rtl"' : ''}>${textHtml}</div></div>`;
  }
  container.innerHTML = html;
  applyActiveState(containerId);
}

// Reflect the current active-subtitle set (and, for the processed viewport, the
// selected lemma) onto the already-rendered DOM without rebuilding it.
function applyActiveState(containerId: string): void {
  const data = viewports.get(containerId);
  const container = document.getElementById(containerId);
  if (!data || !container) return;

  const activeSet = containerId === 'subtitle-viewport-processed' ? activeProcessedSubIdx : activeNativeSubIdx;
  container.querySelectorAll('.subtitle-entry.active').forEach(el => el.classList.remove('active'));
  container.querySelectorAll('.sub-word.active-word').forEach(el => el.classList.remove('active-word'));

  for (const idx of activeSet) {
    const entry = document.getElementById(`${containerId}-sub-${idx}`);
    if (!entry) continue;
    entry.classList.add('active');
    if (data.isProcessed && selectedLemma) {
      entry.querySelectorAll<HTMLElement>(`.sub-word[data-lemma="${CSS.escape(selectedLemma)}"]`)
        .forEach(el => el.classList.add('active-word'));
    }
  }
}

function renderSubtitleViewport(
  subtitles: SubtitleEntry[], containerId: string, lang: DetectedLanguage, isProcessed: boolean
): void {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.classList.remove('lang-arabic', 'lang-latin', 'lang-unknown');
  container.classList.add(`lang-${lang}`);
  viewports.set(containerId, { subtitles, lang, isProcessed });
  scrollLeader = null;
  container.scrollTop = 0;
  renderViewport(containerId);
}

function scrollToSub(containerId: string, subIndex: number): void {
  const container = document.getElementById(containerId);
  const data = viewports.get(containerId);
  if (!container || !data) return;

  // Refresh active highlighting before scrolling so the target shows as active
  // the moment the (possibly animated) scroll begins.
  applyActiveState(containerId);

  centerSub(containerId, subIndex, true);
}

// Scroll a subtitle entry to the vertical centre of its pane. With `smooth`,
// animates only when the target is already on screen (a long smooth jump
// across the file is disorienting); otherwise jumps instantly.
function centerSub(containerId: string, subIndex: number, smooth: boolean): void {
  const container = document.getElementById(containerId);
  const el = document.getElementById(`${containerId}-sub-${subIndex}`);
  if (!container || !el) return;

  const itemTop = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
  const itemHeight = el.offsetHeight;
  const itemBottom = itemTop + itemHeight;
  const visibleTop = container.scrollTop;
  const visibleBottom = visibleTop + container.clientHeight;
  const targetVisible = itemBottom > visibleTop && itemTop < visibleBottom;

  const targetScrollTop = Math.max(0, itemTop - container.clientHeight / 2 + itemHeight / 2);

  if (smooth && targetVisible) {
    container.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
  } else {
    container.scrollTop = targetScrollTop;
  }
}

// The entry occupying the most vertical space in the pane's viewport; ties
// (e.g. several fully visible one-line entries) go to the one nearest the
// centre. Entries are in document order, so binary-search for the first one
// reaching into view, then scan only the visible run.
function mostVisibleEntry(container: HTMLElement): HTMLElement | null {
  const entries = container.children as HTMLCollectionOf<HTMLElement>;
  const n = entries.length;
  if (n === 0) return null;
  const top = container.scrollTop;
  const bottom = top + container.clientHeight;
  const center = (top + bottom) / 2;

  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid].offsetTop + entries[mid].offsetHeight <= top) lo = mid + 1;
    else hi = mid;
  }

  let best: HTMLElement | null = null;
  let bestVisible = 0, bestDist = Infinity;
  for (let i = lo; i < n; i++) {
    const el = entries[i];
    const elTop = el.offsetTop;
    if (elTop >= bottom) break;
    const elBottom = elTop + el.offsetHeight;
    const visible = Math.min(elBottom, bottom) - Math.max(elTop, top);
    const dist = Math.abs((elTop + elBottom) / 2 - center);
    if (visible > bestVisible || (visible === bestVisible && dist < bestDist)) {
      best = el; bestVisible = visible; bestDist = dist;
    }
  }
  return best;
}

function entrySubIndex(el: HTMLElement): number {
  return parseInt(el.id.split('-').pop()!, 10);
}

function setActiveSet(containerId: string, set: Set<number>): void {
  if (containerId === PROCESSED_ID) activeProcessedSubIdx = set;
  else activeNativeSubIdx = set;
}

// Mobile: highlight the leader pane's most visible subtitle and bring the
// time-overlapping subtitle(s) in the other pane to its centre.
function onPaneScrolled(containerId: string): void {
  if (!isMobileLayout() || scrollLeader !== containerId) return;
  const container = document.getElementById(containerId);
  const data = viewports.get(containerId);
  if (!container || !data) return;

  const el = mostVisibleEntry(container);
  if (!el) return;
  const idx = entrySubIndex(el);
  const current = containerId === PROCESSED_ID ? activeProcessedSubIdx : activeNativeSubIdx;
  if (current.size === 1 && current.has(idx)) return;

  setActiveSet(containerId, new Set([idx]));
  applyActiveState(containerId);

  const otherId = containerId === PROCESSED_ID ? NATIVE_ID : PROCESSED_ID;
  const otherSubs = viewports.get(otherId)?.subtitles ?? [];
  const sub = data.subtitles.find(s => s.index === idx);
  const matches = sub && otherSubs.length > 0 ? findOverlapping(sub, otherSubs) : [];
  setActiveSet(otherId, new Set(matches.map(s => s.index)));
  applyActiveState(otherId);
  if (matches.length > 0) centerSub(otherId, matches[0].index, false);
}

function initScrollFocus(): void {
  for (const id of [PROCESSED_ID, NATIVE_ID]) {
    const pane = document.getElementById(id);
    if (!pane) continue;
    const claim = () => { scrollLeader = id; };
    pane.addEventListener('touchstart', claim, { passive: true });
    pane.addEventListener('wheel', claim, { passive: true });
    pane.addEventListener('pointerdown', claim);

    let frame = 0;
    pane.addEventListener('scroll', () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; onPaneScrolled(id); });
    }, { passive: true });
  }
}

function navigateToOccurrence(idx: number): void {
  scrollLeader = null;
  const subIdx = occurrenceList[idx];
  activeProcessedSubIdx = new Set([subIdx]);
  scrollToSub('subtitle-viewport-processed', subIdx);

  const procSub = state.parsedSubtitles.find(s => s.index === subIdx);
  const matches = procSub && nativeSubtitles.length > 0 ? findOverlapping(procSub, nativeSubtitles) : [];
  if (matches.length > 0) {
    activeNativeSubIdx = new Set(matches.map(s => s.index));
    scrollToSub('subtitle-viewport-native', matches[0].index);
  } else {
    activeNativeSubIdx = new Set();
    applyActiveState('subtitle-viewport-native');
  }

  updateNavControls();
}

export function selectLemma(lemma: string): void {
  selectedLemma = lemma;
  state.selectedLemma = lemma;
  occurrenceList = lemmaToSubtitles.get(lemma) ?? [];
  currentOccurrenceIdx = 0;
  updateNavControls();
  if (occurrenceList.length > 0) navigateToOccurrence(0);
}

export function navigateOccurrence(delta: 1 | -1): void {
  if (!occurrenceList.length) return;
  currentOccurrenceIdx = (currentOccurrenceIdx + delta + occurrenceList.length) % occurrenceList.length;
  navigateToOccurrence(currentOccurrenceIdx);
}

function updateNavControls(): void {
  const lemmaEl = document.getElementById('selected-lemma-display');
  const counterEl = document.getElementById('occurrence-counter');
  const prevBtn = document.getElementById('btn-prev-occurrence') as HTMLButtonElement | null;
  const nextBtn = document.getElementById('btn-next-occurrence') as HTMLButtonElement | null;
  if (lemmaEl) lemmaEl.textContent = selectedLemma ?? '—';
  if (counterEl) counterEl.textContent = occurrenceList.length
    ? `${currentOccurrenceIdx + 1} / ${occurrenceList.length}`
    : (selectedLemma ? 'No occurrences' : 'Select a word');
  if (prevBtn) prevBtn.disabled = occurrenceList.length < 2;
  if (nextBtn) nextBtn.disabled = occurrenceList.length < 2;
}

function ensureLemmaVisible(lemma: string): void {
  const entry = state.allResults.find(r => r.lemma === lemma);
  if (entry?.ignored && !state.showingIgnored) {
    state.showingIgnored = true;
    buildVisibleIndices();
    const btn = document.getElementById('btn-toggle-ignored');
    if (btn) btn.innerHTML = '<i class="bi bi-eye"></i> <span class="btn-label">Hide ignored</span>';
  }
}

function handleProcessedWordClick(lemma: string, span: HTMLElement, tooltipWasOpen = false): void {
  const alreadyActive = span.classList.contains('active-word');

  // Save before DOM rebuild
  const segStart = parseInt(span.dataset['segStart'] ?? '', 10);
  const subEntry = span.closest<HTMLElement>('.subtitle-entry');
  const spanSubIdx = subEntry ? parseInt(subEntry.id.split('-').pop()!, 10) : NaN;

  ensureLemmaVisible(lemma);
  scrollTableToLemma(lemma);
  selectedLemma = lemma;
  state.selectedLemma = lemma;
  occurrenceList = lemmaToSubtitles.get(lemma) ?? [];
  currentOccurrenceIdx = 0;

  if (!isNaN(spanSubIdx)) {
    const occIdx = occurrenceList.indexOf(spanSubIdx);
    if (occIdx !== -1) currentOccurrenceIdx = occIdx;
  }

  updateNavControls();
  if (occurrenceList.length > 0) navigateToOccurrence(currentOccurrenceIdx);

  if (alreadyActive && !tooltipWasOpen) {
    // Find new span after DOM rebuild
    const newEntry = document.getElementById(`subtitle-viewport-processed-sub-${spanSubIdx}`);
    const newSpan = newEntry?.querySelector<HTMLElement>(`.sub-word[data-seg-start="${segStart}"]`) ?? null;
    if (newSpan && !isNaN(segStart)) {
      const sub = !isNaN(spanSubIdx) ? state.parsedSubtitles.find(s => s.index === spanSubIdx) : null;
      const seg = sub?.segments.find(s => s.start === segStart);
      if (seg?.analysis) {
        const token = sub ? sub.text.slice(seg.start, seg.start + seg.length) : undefined;
        showWordTooltip(seg.analysis, newSpan, token);
      }
    }
  } else {
    hideWordTooltip();
  }
}

function handleNativeWordClick(entry: HTMLElement): void {
  const idParts = entry.id.split('-');
  const nativeIdx = parseInt(idParts[idParts.length - 1], 10);
  const nativeSub = nativeSubtitles.find(s => s.index === nativeIdx);
  if (!nativeSub || state.parsedSubtitles.length === 0) return;
  const matches = findOverlapping(nativeSub, state.parsedSubtitles);
  if (matches.length === 0) return;

  scrollLeader = null;
  activeNativeSubIdx = new Set([nativeIdx]);
  activeProcessedSubIdx = new Set(matches.map(s => s.index));
  scrollToSub('subtitle-viewport-native', nativeIdx);
  scrollToSub('subtitle-viewport-processed', matches[0].index);
}

export function getNativeSubtitles(): SubtitleEntry[] {
  return nativeSubtitles;
}

export function restoreNativeSubtitles(subs: SubtitleEntry[]): void {
  nativeSubtitles = subs;
  renderSubtitleViewport(nativeSubtitles, 'subtitle-viewport-native', detectLanguage(subs), false);
}

// Shared (received) sessions are read-only on content, so the native-subtitle
// upload control is disabled for non-owners.
function updateNativeUploadAvailability(): void {
  const input = document.getElementById('native-srt-file') as HTMLInputElement | null;
  const label = input?.closest('label');
  const disabled = state.activeSessionId !== null && !state.activeSessionOwned;
  if (input) input.disabled = disabled;
  if (label) {
    label.classList.toggle('disabled', disabled);
    label.title = disabled ? 'Native subtitles can only be loaded by the session owner' : 'Load native SRT';
  }
}

export function onAnalysisComplete(): void {
  hideWordTooltip();
  buildLemmaIndex();
  updateNativeUploadAvailability();
  restoreNativeSubtitles([]);
  const lang = detectLanguage(state.parsedSubtitles);
  const table = document.getElementById('results-table');
  table?.classList.remove('lang-arabic', 'lang-latin', 'lang-unknown');
  table?.classList.add(`lang-${lang}`);
  renderSubtitleViewport(state.parsedSubtitles, 'subtitle-viewport-processed', lang, true);
  selectedLemma = null;
  state.selectedLemma = null;
  occurrenceList = [];
  currentOccurrenceIdx = 0;
  activeProcessedSubIdx = new Set();
  activeNativeSubIdx = new Set();
  updateNavControls();
  renderTable();
}

export function initSubtitleViewer(): void {
  initScrollFocus();

  document.getElementById('native-srt-file')?.addEventListener('change', function (this: HTMLInputElement) {
    const file = this.files?.[0];
    if (!file) return;
    file.text().then(text => {
      nativeSubtitles = parseSrt(text);
      renderSubtitleViewport(nativeSubtitles, 'subtitle-viewport-native', detectLanguage(nativeSubtitles), false);
      // Only the owner may persist native subtitles back to the shared row; a
      // recipient still sees them locally for this view.
      if (state.activeSessionId !== null && state.activeSessionOwned) {
        fetch(`/api/sessions/${state.activeSessionId}/native-subtitles`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ native_subtitles: nativeSubtitles }),
        });
      }
    });
  });

  document.getElementById('btn-prev-occurrence')?.addEventListener('click', () => navigateOccurrence(-1));
  document.getElementById('btn-next-occurrence')?.addEventListener('click', () => navigateOccurrence(1));

  document.getElementById('subtitle-viewport-processed')?.addEventListener('click', e => {
    const span = (e.target as Element).closest<HTMLElement>('.sub-word[data-lemma]');
    if (span?.dataset['lemma']) {
      const tooltipWasAnchoredHere = isWordTooltipAnchor(span);
      handleProcessedWordClick(span.dataset['lemma'], span, tooltipWasAnchoredHere);
    }
  });

  document.getElementById('subtitle-viewport-native')?.addEventListener('click', e => {
    const entry = (e.target as Element).closest<HTMLElement>('.subtitle-entry');
    if (entry) handleNativeWordClick(entry);
  });
}

// Client-side SRT parser for native subtitles — produces SubtitleEntry with segments: []
function parseSrt(text: string): SubtitleEntry[] {
  const results: SubtitleEntry[] = [];
  const blocks = text.trim().split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;
    const idx = parseInt(lines[0].trim(), 10);
    if (isNaN(idx)) continue;
    const timeMatch = lines[1].match(
      /(\d{2}:\d{2}:\d{2}[,.:]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.:]\d{3})/
    );
    if (!timeMatch) continue;
    const startTime = timeMatch[1].replace('.', ',');
    const endTime = timeMatch[2].replace('.', ',');
    const textContent = lines.slice(2).join('\n').replace(/<[^>]+>/g, '').trim();
    if (!textContent) continue;
    results.push({
      index: idx,
      start_time: startTime,
      end_time: endTime,
      start_seconds: parseTimeToSeconds(startTime),
      text: textContent,
      segments: [],
    });
  }
  return results;
}

function endSeconds(s: SubtitleEntry): number {
  return parseTimeToSeconds(s.end_time);
}

// Half-open interval overlap: a starts before b ends AND b starts before a ends.
function overlaps(a: SubtitleEntry, b: SubtitleEntry): boolean {
  return a.start_seconds < endSeconds(b) && b.start_seconds < endSeconds(a);
}

// All entries in `pool` whose time range overlaps `target`; falls back to the single
// nearest-by-start entry when none overlap (never returns empty if pool is non-empty).
function findOverlapping(target: SubtitleEntry, pool: SubtitleEntry[]): SubtitleEntry[] {
  const hits = pool.filter(s => overlaps(s, target));
  if (hits.length > 0) return hits;
  if (pool.length === 0) return [];
  const nearest = pool.reduce((best, s) =>
    Math.abs(s.start_seconds - target.start_seconds) < Math.abs(best.start_seconds - target.start_seconds)
      ? s : best);
  return [nearest];
}

function parseTimeToSeconds(time: string): number {
  const normalized = time.replace(',', '.');
  const dotIdx = normalized.lastIndexOf('.');
  const hms = normalized.slice(0, dotIdx);
  const ms = parseFloat('0.' + normalized.slice(dotIdx + 1));
  const parts = hms.split(':').map(Number);
  return parts[0] * 3600 + parts[1] * 60 + parts[2] + ms;
}
