import type { WordFrequency } from './types';

export const state = {
  currentLanguage: 'ar-msa',
  currentFilename: '',
  currentSrtText: '',
  activeSessionId: null as number | null,
  showingIgnored: false,
  allResults: [] as WordFrequency[],
  visibleIndices: [] as number[],
  totalTokensCached: 0,
};

export function buildVisibleIndices(): void {
  state.visibleIndices = [];
  for (let i = 0; i < state.allResults.length; i++) {
    if (state.showingIgnored || !state.allResults[i].ignored) state.visibleIndices.push(i);
  }
}
