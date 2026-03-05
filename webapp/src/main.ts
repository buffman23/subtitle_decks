import { applyColWidths, initColResize } from './ui/colResize';
import { renderVirtual, registerIgnoreHandler, registerUnignoreHandler, registerLemmaSelectHandler } from './ui/virtualScroll';
import { initAnalyzeForm, initToggleIgnored, registerAnalysisCompleteHandler } from './features/analyze';
import { initSessions, loadSessions, checkPendingSession, registerSessionAnalysisCompleteHandler } from './features/sessions';
import { initIgnoreList, addToIgnoreList, removeFromIgnoreList } from './features/ignorelist';
import { initCsvExport } from './features/csvExport';
import { initSubtitleViewer, selectLemma, onAnalysisComplete } from './features/subtitleViewer';
import { state } from './state';

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
    state.allResults = [];
    document.getElementById('results-section')?.classList.add('d-none');
    document.getElementById('upload-section')?.classList.remove('d-none');
    if (IS_LOGGED_IN) loadSessions();
  });
}

/* ── Wire up all modules ── */
registerIgnoreHandler(addToIgnoreList);
registerUnignoreHandler(removeFromIgnoreList);
registerLemmaSelectHandler(selectLemma);
registerAnalysisCompleteHandler(onAnalysisComplete);
registerSessionAnalysisCompleteHandler(onAnalysisComplete);

initAnalyzeForm();
initToggleIgnored();
initSessions();
initIgnoreList();
initCsvExport();
initSubtitleViewer();

applyColWidths();
initColResize();

/* ── Virtual scroll listener ── */
document.querySelector('.results-table-wrapper')?.addEventListener('scroll', function (this: HTMLElement) {
  renderVirtual(this.scrollTop, this.clientHeight);
});

/* ── Load sessions on startup (restore pending session if returning from OAuth) ── */
if (IS_LOGGED_IN) checkPendingSession();
