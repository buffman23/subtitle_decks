import type { SubtitleEntry, SubtitleSegment } from '../types';
import { state, buildVisibleIndices } from '../state';
import { escapeHtml, scrollTableToLemma, renderVirtual } from '../ui/virtualScroll';

// Module-level state
let nativeSubtitles: SubtitleEntry[] = [];
let lemmaToSubtitles: Map<string, number[]> = new Map(); // lemma → subtitle indices
let selectedLemma: string | null = null;
let occurrenceList: number[] = [];
let currentOccurrenceIdx = 0;

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
    result += `<span class="sub-word" data-lemma="${escapeHtml(seg.lemma)}">${escapeHtml(surface)}</span>`;
    pos = seg.start + seg.length;
  }
  if (pos < text.length) result += escapeHtml(text.slice(pos));
  return result;
}

function renderNativeText(text: string): string {
  return escapeHtml(text);
}

function renderSubtitleViewport(
  subtitles: SubtitleEntry[], containerId: string, isRtl: boolean, isProcessed: boolean
): void {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  for (const sub of subtitles) {
    const div = document.createElement('div');
    div.className = 'subtitle-entry';
    div.id = `${containerId}-sub-${sub.index}`;
    const textHtml = isProcessed
      ? renderProcessedText(sub.text, sub.segments)
      : renderNativeText(sub.text);
    div.innerHTML = `
      <div class="sub-number">${sub.index}</div>
      <div class="sub-time">${escapeHtml(sub.start_time)} → ${escapeHtml(sub.end_time)}</div>
      <div class="sub-text"${isRtl ? ' dir="rtl"' : ''}>${textHtml}</div>`;
    container.appendChild(div);
  }
}

function scrollIntoViewport(entry: HTMLElement): void {
  const container = entry.closest('.subtitle-viewport') as HTMLElement | null;
  if (!container) return;
  const entryRect = entry.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const target = container.scrollTop + (entryRect.top - containerRect.top) - container.clientHeight / 2 + entry.offsetHeight / 2;
  container.scrollTo({ top: target, behavior: 'smooth' });
}

function navigateToOccurrence(idx: number, scrollProcessed = true): void {
  document.querySelectorAll('.subtitle-entry.active').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.sub-word.active-word').forEach(el => el.classList.remove('active-word'));

  const subIdx = occurrenceList[idx];

  const procEntry = document.getElementById(`subtitle-viewport-processed-sub-${subIdx}`);
  procEntry?.classList.add('active');
  if (scrollProcessed && procEntry) scrollIntoViewport(procEntry);
  procEntry?.querySelectorAll<HTMLElement>(`.sub-word[data-lemma="${CSS.escape(selectedLemma!)}"]`)
    .forEach(el => el.classList.add('active-word'));

  const procSub = state.parsedSubtitles.find(s => s.index === subIdx);
  if (procSub && nativeSubtitles.length > 0) {
    const nearest = nativeSubtitles.reduce((best, s) =>
      Math.abs(s.start_seconds - procSub.start_seconds) < Math.abs(best.start_seconds - procSub.start_seconds)
        ? s : best
    );
    const natEntry = document.getElementById(`subtitle-viewport-native-sub-${nearest.index}`);
    natEntry?.classList.add('active');
    if (natEntry) scrollIntoViewport(natEntry);
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
    if (btn) btn.innerHTML = '<i class="bi bi-eye"></i> Hide ignored';
  }
}

function handleProcessedWordClick(lemma: string, span: HTMLElement): void {
  ensureLemmaVisible(lemma);
  scrollTableToLemma(lemma);
  selectedLemma = lemma;
  state.selectedLemma = lemma;
  occurrenceList = lemmaToSubtitles.get(lemma) ?? [];
  // Start at the occurrence that was clicked, not always the first one
  currentOccurrenceIdx = 0;
  const entry = span.closest<HTMLElement>('.subtitle-entry');
  if (entry) {
    const subIdx = parseInt(entry.id.split('-').pop()!, 10);
    if (!isNaN(subIdx)) {
      const occIdx = occurrenceList.indexOf(subIdx);
      if (occIdx !== -1) currentOccurrenceIdx = occIdx;
    }
  }
  updateNavControls();
  if (occurrenceList.length > 0) navigateToOccurrence(currentOccurrenceIdx);
}

function handleNativeWordClick(entry: HTMLElement): void {
  const idParts = entry.id.split('-');
  const nativeIdx = parseInt(idParts[idParts.length - 1], 10);
  const nativeSub = nativeSubtitles.find(s => s.index === nativeIdx);
  if (!nativeSub || state.parsedSubtitles.length === 0) return;
  const nearest = state.parsedSubtitles.reduce((best, s) =>
    Math.abs(s.start_seconds - nativeSub.start_seconds) < Math.abs(best.start_seconds - nativeSub.start_seconds)
      ? s : best
  );
  document.querySelectorAll('.subtitle-entry.active').forEach(el => el.classList.remove('active'));
  entry.classList.add('active');
  scrollIntoViewport(entry);
  const procEntry = document.getElementById(`subtitle-viewport-processed-sub-${nearest.index}`);
  procEntry?.classList.add('active');
  if (procEntry) scrollIntoViewport(procEntry);
}

export function getNativeSubtitles(): SubtitleEntry[] {
  return nativeSubtitles;
}

export function restoreNativeSubtitles(subs: SubtitleEntry[]): void {
  nativeSubtitles = subs;
  renderSubtitleViewport(nativeSubtitles, 'subtitle-viewport-native', false, false);
}

export function onAnalysisComplete(): void {
  buildLemmaIndex();
  renderSubtitleViewport(state.parsedSubtitles, 'subtitle-viewport-processed', true, true);
  // Reset nav controls
  selectedLemma = null;
  state.selectedLemma = null;
  occurrenceList = [];
  currentOccurrenceIdx = 0;
  updateNavControls();
  // Re-render table to clear any previous selected-row highlight
  const wrapper = document.querySelector('.results-table-wrapper') as HTMLElement | null;
  if (wrapper) renderVirtual(wrapper.scrollTop, wrapper.clientHeight);
}

export function initSubtitleViewer(): void {
  document.getElementById('native-srt-file')?.addEventListener('change', function (this: HTMLInputElement) {
    const file = this.files?.[0];
    if (!file) return;
    file.text().then(text => {
      nativeSubtitles = parseSrt(text);
      renderSubtitleViewport(nativeSubtitles, 'subtitle-viewport-native', false, false);
    });
  });

  document.getElementById('btn-prev-occurrence')?.addEventListener('click', () => navigateOccurrence(-1));
  document.getElementById('btn-next-occurrence')?.addEventListener('click', () => navigateOccurrence(1));

  document.getElementById('subtitle-viewport-processed')?.addEventListener('click', e => {
    const span = (e.target as Element).closest<HTMLElement>('.sub-word[data-lemma]');
    if (span?.dataset['lemma']) handleProcessedWordClick(span.dataset['lemma'], span);
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

function parseTimeToSeconds(time: string): number {
  const normalized = time.replace(',', '.');
  const dotIdx = normalized.lastIndexOf('.');
  const hms = normalized.slice(0, dotIdx);
  const ms = parseFloat('0.' + normalized.slice(dotIdx + 1));
  const parts = hms.split(':').map(Number);
  return parts[0] * 3600 + parts[1] * 60 + parts[2] + ms;
}
