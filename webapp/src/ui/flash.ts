export function flash(msg: string, type: 'success' | 'danger' | 'warning' | 'info' = 'success'): void {
  const container = document.getElementById('flash-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `alert alert-${type} flash-alert shadow`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}
