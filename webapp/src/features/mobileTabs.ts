import { state } from '../state';
import { scrollTableToLemma } from '../ui/virtualScroll';

/* ── Mobile bottom tab bar. Below the md breakpoint the app shows one
   full-height view at a time; the active one is exposed to CSS as
   body[data-mobile-tab]. Above md the attribute is ignored. ── */

export type MobileTab = 'words' | 'subtitles';

// Must match the mobile breakpoint in style.css.
const mobileQuery = window.matchMedia('(max-width: 767.98px)');

export function isMobileLayout(): boolean {
  return mobileQuery.matches;
}

export function setMobileTab(tab: MobileTab): void {
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
  // The table was hidden while another tab was showing, so its scroll position
  // couldn't follow the selected word; re-centre it now that it has a size.
  if (tab === 'words' && state.selectedLemma && isMobileLayout()) scrollTableToLemma(state.selectedLemma);
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
