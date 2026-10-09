import type { WordFrequency, SubtitleEntry } from './types';
import type { LemmaPos } from './ui/pos';

export const state = {
  currentLanguage: 'ar-msa',
  currentFilename: '',
  activeSessionId: null as number | null,
  // Whether the current viewer owns the active session. Shared (received)
  // sessions are read-only on content, so owner-only writes (native-subtitle
  // persistence) are skipped when this is false.
  activeSessionOwned: true,
  showingIgnored: false,
  allResults: [] as WordFrequency[],
  visibleIndices: [] as number[],
  totalTokensCached: 0,
  parsedSubtitles: [] as SubtitleEntry[],
  selectedLemma: null as string | null,
  // POS the subtitle navigation is filtered to for selectedLemma (null = all).
  selectedPos: null as string | null,
  // Most frequent part of speech per lemma, derived from parsedSubtitles.
  posByLemma: new Map<string, LemmaPos>(),
  // The analysis currently being processed by the server, surfaced as a
  // placeholder in the sessions sidebar so the user can navigate away and come
  // back to it. null when no analysis is running.
  pendingJob: null as null | {
    jobId: string;
    filename: string;
    language: string;
    status: string;          // queued | running
    position: number | null; // queue position while queued
    cancelling: boolean;     // user requested cancel; awaiting server
  },
  // True while the main view is showing the in-progress analysis (vs. the user
  // having navigated to a saved session while it runs in the background).
  viewingPending: false,
};

export function buildVisibleIndices(): void {
  state.visibleIndices = [];
  for (let i = 0; i < state.allResults.length; i++) {
    if (state.showingIgnored || !state.allResults[i].ignored) state.visibleIndices.push(i);
  }
}
