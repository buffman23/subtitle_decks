function getMenu() { return document.getElementById('fab-menu'); }
function getIcon() { return document.getElementById('fab-icon'); }

function setOpen(open: boolean) {
  getMenu()?.classList.toggle('d-none', !open);
  const icon = getIcon();
  if (icon) icon.className = open ? 'bi bi-x-lg' : 'bi bi-three-dots-vertical';
}

export function closeFab() {
  setOpen(false);
}

export function initFab() {
  document.getElementById('btn-fab-toggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(!!getMenu()?.classList.contains('d-none'));
  });

  document.addEventListener('click', (e) => {
    if (!(e.target as Element).closest('#fab-container')) {
      setOpen(false);
    }
  });
}
