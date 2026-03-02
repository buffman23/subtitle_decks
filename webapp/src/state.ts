import type { WordFrequency, SubtitleEntry } from './types';

export const state = {
  currentLanguage: 'ar-msa',
  currentFilename: '',
  activeSessionId: null as number | null,
  showingIgnored: false,
  allResults: [] as WordFrequency[],
  visibleIndices: [] as number[],
  totalTokensCached: 0,
  parsedSubtitles: [] as SubtitleEntry[],
  selectedLemma: null as string | null,
};

export function buildVisibleIndices(): void {
  state.visibleIndices = [];
  for (let i = 0; i < state.allResults.length; i++) {
    if (state.showingIgnored || !state.allResults[i].ignored) state.visibleIndices.push(i);
  }
}
