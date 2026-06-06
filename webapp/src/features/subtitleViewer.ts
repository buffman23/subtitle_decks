import type { SubtitleEntry, SubtitleSegment } from '../types';
import { state, buildVisibleIndices } from '../state';
import { escapeHtml, scrollTableToLemma, renderVirtual } from '../ui/virtualScroll';
import { showWordTooltip, hideWordTooltip, isWordTooltipAnchor } from '../ui/wordTooltip';

const ROW_HEIGHT_EST = 100;
const OVERSCAN = 3;

type DetectedLanguage = 'arabic' | 'latin' | 'unknown';

interface ViewportData {
  subtitles: SubtitleEntry[];
  lang: DetectedLanguage;
  isProcessed: boolean;
  lastStart: number;
  lastEnd: number;
}

// Module-level state
let nativeSubtitles: SubtitleEntry[] = [];
let lemmaToSubtitles: Map<string, number[]> = new Map();
let selectedLemma: string | null = null;
let occurrenceList: number[] = [];
let currentOccurrenceIdx = 0;
let activeProcessedSubIdx: number | null = null;
let activeNativeSubIdx: number | null = null;
const viewports = new Map<string, ViewportData>();

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

function renderWindow(containerId: string): void {
  const data = viewports.get(containerId);
  const container = document.getElementById(containerId);
  if (!data || !container) return;

  const { subtitles, lang, isProcessed } = data;
  const total = subtitles.length;
  if (total === 0) { container.innerHTML = ''; return; }

  const scrollTop = container.scrollTop;
  const clientHeight = container.clientHeight || ROW_HEIGHT_EST * 5;

  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT_EST) - OVERSCAN);
  const endIdx = Math.min(total - 1, Math.ceil((scrollTop + clientHeight) / ROW_HEIGHT_EST) + OVERSCAN);

  if (data.lastStart === startIdx && data.lastEnd === endIdx) return;
  data.lastStart = startIdx;
  data.lastEnd = endIdx;

  const isRtl = lang === 'arabic';
  const activeSubIdx = containerId === 'subtitle-viewport-processed' ? activeProcessedSubIdx : activeNativeSubIdx;

  // Inner container has fixed total height so scrollHeight is stable while scrolling.
  const inner = document.createElement('div');
  inner.style.position = 'relative';
  inner.style.height = `${total * ROW_HEIGHT_EST}px`;

  for (let i = startIdx; i <= endIdx; i++) {
    const sub = subtitles[i];
    const isActive = sub.index === activeSubIdx;
    const div = document.createElement('div');
    div.className = 'subtitle-entry' + (isActive ? ' active' : '');
    div.id = `${containerId}-sub-${sub.index}`;
    div.style.position = 'absolute';
    div.style.top = `${i * ROW_HEIGHT_EST}px`;
    div.style.left = '0';
    div.style.right = '0';
    const textHtml = isProcessed
      ? renderProcessedText(sub.text, sub.segments)
      : renderNativeText(sub.text);
    div.innerHTML = `
      <div class="sub-number">${sub.index}</div>
      <div class="sub-time">${escapeHtml(sub.start_time)} → ${escapeHtml(sub.end_time)}</div>
      <div class="sub-text"${isRtl ? ' dir="rtl"' : ''}>${textHtml}</div>`;

    if (isProcessed && isActive && selectedLemma) {
      div.querySelectorAll<HTMLElement>(`.sub-word[data-lemma="${CSS.escape(selectedLemma)}"]`)
        .forEach(el => el.classList.add('active-word'));
    }

    inner.appendChild(div);
  }

  container.innerHTML = '';
  container.appendChild(inner);
}

function renderSubtitleViewport(
  subtitles: SubtitleEntry[], containerId: string, lang: DetectedLanguage, isProcessed: boolean
): void {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.classList.remove('lang-arabic', 'lang-latin', 'lang-unknown');
  container.classList.add(`lang-${lang}`);
  viewports.set(containerId, { subtitles, lang, isProcessed, lastStart: -1, lastEnd: -1 });
  container.scrollTop = 0;
  renderWindow(containerId);
}

function scrollToSub(containerId: string, subIndex: number): void {
  const container = document.getElementById(containerId);
  const data = viewports.get(containerId);
  if (!container || !data) return;

  const arrIdx = data.subtitles.findIndex(s => s.index === subIndex);
  if (arrIdx === -1) return;

  const itemTop = arrIdx * ROW_HEIGHT_EST;
  const itemBottom = itemTop + ROW_HEIGHT_EST;
  const visibleTop = container.scrollTop;
  const visibleBottom = visibleTop + container.clientHeight;
  const targetVisible = itemBottom > visibleTop && itemTop < visibleBottom;

  const targetScrollTop = Math.max(0, itemTop - container.clientHeight / 2 + ROW_HEIGHT_EST / 2);

  // Force re-render so the new active-class state shows up immediately,
  // before the (possibly animated) scroll begins.
  data.lastStart = -1;
  data.lastEnd = -1;
  renderWindow(containerId);

  if (targetVisible) {
    container.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
  } else {
    container.scrollTop = targetScrollTop;
  }
}

function navigateToOccurrence(idx: number): void {
  const subIdx = occurrenceList[idx];
  activeProcessedSubIdx = subIdx;
  scrollToSub('subtitle-viewport-processed', subIdx);

  const procSub = state.parsedSubtitles.find(s => s.index === subIdx);
  if (procSub && nativeSubtitles.length > 0) {
    const nearest = nativeSubtitles.reduce((best, s) =>
      Math.abs(s.start_seconds - procSub.start_seconds) < Math.abs(best.start_seconds - procSub.start_seconds)
        ? s : best
    );
    activeNativeSubIdx = nearest.index;
    scrollToSub('subtitle-viewport-native', nearest.index);
  } else {
    activeNativeSubIdx = null;
    const data = viewports.get('subtitle-viewport-native');
    if (data) { data.lastStart = -1; data.lastEnd = -1; }
    renderWindow('subtitle-viewport-native');
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
  const nearest = state.parsedSubtitles.reduce((best, s) =>
    Math.abs(s.start_seconds - nativeSub.start_seconds) < Math.abs(best.start_seconds - nativeSub.start_seconds)
      ? s : best
  );

  activeNativeSubIdx = nativeIdx;
  activeProcessedSubIdx = nearest.index;
  scrollToSub('subtitle-viewport-native', nativeIdx);
  scrollToSub('subtitle-viewport-processed', nearest.index);
}

export function getNativeSubtitles(): SubtitleEntry[] {
  return nativeSubtitles;
}

export function restoreNativeSubtitles(subs: SubtitleEntry[]): void {
  nativeSubtitles = subs;
  renderSubtitleViewport(nativeSubtitles, 'subtitle-viewport-native', detectLanguage(subs), false);
}

export function onAnalysisComplete(): void {
  hideWordTooltip();
  buildLemmaIndex();
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
  activeProcessedSubIdx = null;
  activeNativeSubIdx = null;
  updateNavControls();
  const wrapper = document.querySelector('.results-table-wrapper') as HTMLElement | null;
  if (wrapper) renderVirtual(wrapper.scrollTop, wrapper.clientHeight);
}

export function initSubtitleViewer(): void {
  document.getElementById('native-srt-file')?.addEventListener('change', function (this: HTMLInputElement) {
    const file = this.files?.[0];
    if (!file) return;
    file.text().then(text => {
      nativeSubtitles = parseSrt(text);
      renderSubtitleViewport(nativeSubtitles, 'subtitle-viewport-native', detectLanguage(nativeSubtitles), false);
      if (state.activeSessionId !== null) {
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

  document.getElementById('subtitle-viewport-processed')?.addEventListener('scroll', () => {
    renderWindow('subtitle-viewport-processed');
  });

  document.getElementById('subtitle-viewport-native')?.addEventListener('scroll', () => {
    renderWindow('subtitle-viewport-native');
  });

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

function parseTimeToSeconds(time: string): number {
  const normalized = time.replace(',', '.');
  const dotIdx = normalized.lastIndexOf('.');
  const hms = normalized.slice(0, dotIdx);
  const ms = parseFloat('0.' + normalized.slice(dotIdx + 1));
  const parts = hms.split(':').map(Number);
  return parts[0] * 3600 + parts[1] * 60 + parts[2] + ms;
}
