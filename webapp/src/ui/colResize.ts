const COL_WIDTHS_KEY = 'subtitleAnalyzer.colWidths';

export function applyColWidths(): void {
  const saved = localStorage.getItem(COL_WIDTHS_KEY);
  if (!saved) return;
  const widths: (number | null)[] = JSON.parse(saved);
  document.querySelectorAll<HTMLElement>('#results-table thead th').forEach((th, i) => {
    if (widths[i] != null) th.style.width = widths[i] + 'px';
  });
}

function saveColWidths(): void {
  const widths = [...document.querySelectorAll<HTMLElement>('#results-table thead th')].map(th => th.offsetWidth);
  localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(widths));
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
