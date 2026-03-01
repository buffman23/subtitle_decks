import { applyColWidths, initColResize } from './ui/colResize';
import { renderVirtual } from './ui/virtualScroll';
import { registerIgnoreHandler, registerUnignoreHandler } from './ui/virtualScroll';
import { initAnalyzeForm, initToggleIgnored } from './features/analyze';
import { initSessions, loadSessions } from './features/sessions';
import { initIgnoreList, addToIgnoreList, removeFromIgnoreList } from './features/ignorelist';
import { initCsvExport } from './features/csvExport';
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
    if (IS_LOGGED_IN) loadSessions();
  });
}

/* ── Wire up all modules ── */
registerIgnoreHandler(addToIgnoreList);
registerUnignoreHandler(removeFromIgnoreList);

initAnalyzeForm();
initToggleIgnored();
initSessions();
initIgnoreList();
initCsvExport();

applyColWidths();
initColResize();

/* ── Virtual scroll listener ── */
document.querySelector('.results-table-wrapper')?.addEventListener('scroll', function (this: HTMLElement) {
  renderVirtual(this.scrollTop, this.clientHeight);
});

/* ── Load sessions on startup ── */
if (IS_LOGGED_IN) loadSessions();
