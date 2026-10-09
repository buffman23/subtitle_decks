/* ── Mobile bottom tab bar. Below the md breakpoint the app shows one
   full-height view at a time; the active one is exposed to CSS as
   body[data-mobile-tab], which slides a three-panel track between them.
   Both panels stay laid out while off-screen, so the table and subtitle
   panes can be scrolled into place before they slide in. Above md the
   attribute is ignored. ── */

import { state } from '../state';
import { showDefinitionPanel } from './definitions';

export type MobileTab = 'words' | 'subtitles' | 'definition';

// Must match the mobile breakpoint in style.css.
const mobileQuery = window.matchMedia('(max-width: 767.98px)');

export function isMobileLayout(): boolean {
  return mobileQuery.matches;
}

export function setMobileTab(tab: MobileTab): void {
  if (tab === 'definition') showDefinitionPanel(state.selectedLemma);
  document.body.dataset['mobileTab'] = tab;
  document.querySelectorAll<HTMLButtonElement>('#mobile-tabbar button[data-tab]').forEach(btn => {
    const active = btn.dataset['tab'] === tab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-current', active ? 'page' : 'false');
    const icon = btn.querySelector<HTMLElement>('i[data-icon]');
    const base = icon?.dataset['icon'];
    // Filled icon variant marks the active tab (no fill variant for list-ol).
    if (icon && base) icon.className = `bi ${active && base !== 'bi-list-ol' ? base + '-fill' : base}`;
  });
}

/** Close the sessions drawer and bring the word table (or upload form)
    forward once a session, analysis or new upload has been picked. */
export function onMobileSessionShown(): void {
  if (!isMobileLayout()) return;
  const sidebar = document.getElementById('sidebar');
  if (sidebar) bootstrap.Offcanvas.getInstance(sidebar)?.hide();
  setMobileTab('words');
}

export function initMobileTabs(): void {
  document.querySelectorAll<HTMLButtonElement>('#mobile-tabbar button[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => setMobileTab(btn.dataset['tab'] as MobileTab));
  });
  setMobileTab('words');
}
