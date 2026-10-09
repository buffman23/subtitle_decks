import { applyColWidths, initColResize, applySidebarWidth, initSidebarResize } from './ui/colResize';
import { registerIgnoreHandler, registerUnignoreHandler, registerLemmaSelectHandler, renderTable } from './ui/virtualScroll';
import { registerPosPickHandler } from './ui/pos';
import { initAnalyzeForm, initToggleIgnored, registerAnalysisCompleteHandler, resumePendingAnalysis } from './features/analyze';
import { initSessions, loadSessions, checkPendingSession, openSession, registerSessionAnalysisCompleteHandler } from './features/sessions';
import { initIgnoreList, addToIgnoreList, removeFromIgnoreList } from './features/ignorelist';
import { initCsvExport } from './features/csvExport';
import { initPosHelp } from './features/posHelp';
import { initSharing } from './features/sharing';
import { initSubtitleViewer, selectLemma, onAnalysisComplete } from './features/subtitleViewer';
import { initWordTooltip } from './ui/wordTooltip';
import { initMobileTabs, isMobileLayout, setMobileTab, onMobileSessionShown } from './features/mobileTabs';
import { state } from './state';

/* ── Signal to the global notifier.js that the full app bundle owns the job
   lifecycle on this page (in-page progress + toasts), so it stays inert here
   and only fires on pages that lack this bundle. ── */
(window as unknown as { SUBTITLE_DECKS_APP?: boolean }).SUBTITLE_DECKS_APP = true;

/* ── Language select with localStorage persistence ── */
const languageSelect = document.getElementById('language-select') as HTMLSelectElement | null;
if (languageSelect) {
  const saved = localStorage.getItem('subtitleAnalyzer.language');
  if (saved && [...languageSelect.options].some(o => o.value === saved)) {
    languageSelect.value = saved;
  }
  // Sync initial state
  state.currentLanguage = languageSelect.value;

  languageSelect.addEventListener('change', () => {
    state.currentLanguage = languageSelect.value;
    localStorage.setItem('subtitleAnalyzer.language', languageSelect.value);
    // Clear results — language context has changed
    state.activeSessionId = null;
    state.viewingPending = false;
    state.allResults = [];
    document.getElementById('results-section')?.classList.add('d-none');
    document.getElementById('upload-section')?.classList.remove('d-none');
    if (DEMO_MODE || IS_LOGGED_IN) loadSessions();
  });
}

/* ── Wire up all modules ── */
registerIgnoreHandler(addToIgnoreList);
registerUnignoreHandler(removeFromIgnoreList);
// On mobile, tapping a word jumps to the Subtitles tab. Switch first: the
// occurrence scroll measures the panes, which have no size while hidden.
registerLemmaSelectHandler(lemma => {
  if (isMobileLayout()) setMobileTab('subtitles');
  selectLemma(lemma);
});
// Picking a POS from a POS cell's menu selects that word filtered to the POS.
registerPosPickHandler((lemma, pos) => {
  if (isMobileLayout()) setMobileTab('subtitles');
  selectLemma(lemma, pos);
  renderTable();
});
const onResultsShown = () => { onAnalysisComplete(); onMobileSessionShown(); };
registerAnalysisCompleteHandler(onResultsShown);
registerSessionAnalysisCompleteHandler(onResultsShown);

initAnalyzeForm();
initToggleIgnored();
initSessions();
initIgnoreList();
initCsvExport();
initSharing();
initSubtitleViewer();
initPosHelp();
initWordTooltip();
initMobileTabs();

applyColWidths();
initColResize();
applySidebarWidth();
initSidebarResize();

/* ── On the public demo page, just load the demo sessions into the sidebar for
   everyone (logged in or not); skip all the owned-session bootstrapping below. ── */
if (DEMO_MODE) void loadSessions();

/* ── Load sessions on startup (also restores + saves any pending session left by an anonymous user who just signed in) ── */
if (!DEMO_MODE && IS_LOGGED_IN) checkPendingSession();

/* ── Re-attach the sidebar placeholder to an analysis still running from a
   previous page (survives navigation/reload). ── */
if (!DEMO_MODE && IS_LOGGED_IN) void resumePendingAnalysis();

/* ── Deep-link: /?session=<id> (used by the notifier's completion toast) opens
   that session, then strips the param so a refresh won't reopen it. ── */
if (!DEMO_MODE && IS_LOGGED_IN) {
  const sessionParam = new URLSearchParams(window.location.search).get('session');
  const sessionId = sessionParam ? Number(sessionParam) : NaN;
  if (Number.isInteger(sessionId) && sessionId > 0) {
    void openSession(sessionId);
    const url = new URL(window.location.href);
    url.searchParams.delete('session');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  }
}
