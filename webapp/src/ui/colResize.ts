const COL_WIDTHS_KEY = 'subtitleAnalyzer.colWidths';
const SIDEBAR_WIDTH_KEY = 'subtitleAnalyzer.sidebarWidth';
const SIDEBAR_MIN_WIDTH = 160;

export function applyColWidths(): void {
  const saved = localStorage.getItem(COL_WIDTHS_KEY);
  if (!saved) return;
  const widths: (number | null)[] = JSON.parse(saved);
  const ths = document.querySelectorAll<HTMLElement>('#results-table thead th');
  // Widths are saved by column index; ignore them if the columns have changed.
  if (widths.length !== ths.length) return;
  ths.forEach((th, i) => {
    if (widths[i] != null) th.style.width = widths[i] + 'px';
  });
}

function saveColWidths(): void {
  const widths = [...document.querySelectorAll<HTMLElement>('#results-table thead th')].map(th => th.offsetWidth);
  localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(widths));
}

export function applySidebarWidth(): void {
  const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
  if (!saved) return;
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.style.width = saved + 'px';
}

export function initSidebarResize(): void {
  const handle = document.getElementById('sidebar-resize-handle');
  const sidebar = document.getElementById('sidebar');
  if (!handle || !sidebar) return;

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    handle.classList.add('resizing');
    const sidebarLeft = sidebar.getBoundingClientRect().left;

    const onMouseMove = (e: MouseEvent) => {
      sidebar.style.width = Math.max(SIDEBAR_MIN_WIDTH, e.clientX - sidebarLeft) + 'px';
    };
    const onMouseUp = () => {
      handle.classList.remove('resizing');
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebar.offsetWidth));
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}

export function initColResize(): void {
  document.querySelectorAll<HTMLElement>('#results-table thead th .col-resize-handle').forEach(handle => {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const th = handle.closest('th') as HTMLElement;
      const thLeft = th.getBoundingClientRect().left;
      handle.classList.add('resizing');

      const onMouseMove = (e: MouseEvent) => {
        th.style.width = Math.max(40, e.clientX - thLeft) + 'px';
      };
      const onMouseUp = () => {
        handle.classList.remove('resizing');
        saveColWidths();
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  });
}
