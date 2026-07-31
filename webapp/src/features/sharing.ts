import { flash } from '../ui/flash';

interface ShareRecipient {
  user_id: number;
  email: string;
}

// The session whose share controls are currently displayed. Owner-only.
let currentSessionId: number | null = null;
// Whether that session is currently featured on the demo page (admin toggle).
let currentIsDemo = false;

function el(id: string): HTMLElement | null {
  return document.getElementById(id);
}

/** Reflect the current demo state in the admin dropdown's toggle label. */
function renderDemoToggle(): void {
  const label = el('demo-share-label');
  if (label) label.textContent = currentIsDemo ? 'Remove from demo page' : 'Add to demo page';
}

/** Hide the Share dropdown (e.g. when viewing a shared or unsaved session). */
export function hideShareControls(): void {
  el('share-dropdown-wrapper')?.classList.add('d-none');
}

/**
 * Show/populate the owner's Share dropdown for a session. Only the owner of a
 * saved session can share, so the control is hidden for shared sessions, for
 * anonymous viewers, and for unsaved analyses (sessionId null).
 */
export function renderShareControls(
  sessionId: number | null,
  owned: boolean,
  shares: ShareRecipient[],
  isDemo = false,
): void {
  const wrapper = el('share-dropdown-wrapper');
  if (!wrapper) return;
  if (!owned || !IS_LOGGED_IN || sessionId == null) {
    hideShareControls();
    return;
  }
  currentSessionId = sessionId;
  currentIsDemo = isDemo;
  wrapper.classList.remove('d-none');
  renderRecipients(shares);
  renderDemoToggle();
}

function renderRecipients(shares: ShareRecipient[]): void {
  const listEl = el('share-recipient-list');
  if (!listEl) return;
  if (shares.length === 0) {
    listEl.innerHTML = '<div class="text-muted small px-2 py-1">Not shared with anyone yet.</div>';
    return;
  }
  listEl.innerHTML = '';
  shares.forEach((r) => {
    const row = document.createElement('div');
    row.className = 'd-flex align-items-center justify-content-between gap-2 px-2 py-1';
    row.innerHTML = `
      <span class="text-truncate small" title="${r.email}">${r.email}</span>
      <button class="btn btn-sm btn-link text-danger p-0 ms-2 btn-unshare" data-uid="${r.user_id}" title="Unshare">
        <i class="bi bi-x-lg"></i>
      </button>`;
    listEl.appendChild(row);
  });
}

async function addShare(email: string): Promise<void> {
  const trimmed = email.trim();
  if (currentSessionId == null || !trimmed) return;
  const res = await fetch(`/api/sessions/${currentSessionId}/shares`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: trimmed }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    flash(body.detail ?? 'Failed to share session.', 'danger');
    return;
  }
  renderRecipients(body as ShareRecipient[]);
  const input = el('share-email-input') as HTMLInputElement | null;
  if (input) input.value = '';
  flash(`Shared with ${trimmed}.`, 'success');
}

/** Admin-only: flag / unflag the current session as a demo-page feature. */
async function toggleDemo(): Promise<void> {
  if (currentSessionId == null) return;
  const adding = !currentIsDemo;
  const res = await fetch(`/api/sessions/${currentSessionId}/demo`, {
    method: adding ? 'POST' : 'DELETE',
  });
  if (!res.ok) {
    flash('Failed to update demo page.', 'danger');
    return;
  }
  currentIsDemo = adding;
  renderDemoToggle();
  flash(adding ? 'Added to the demo page.' : 'Removed from the demo page.', 'success');
}

async function removeShare(userId: number): Promise<void> {
  if (currentSessionId == null) return;
  const res = await fetch(`/api/sessions/${currentSessionId}/shares/${userId}`, { method: 'DELETE' });
  if (!res.ok) {
    flash('Failed to unshare.', 'danger');
    return;
  }
  const listRes = await fetch(`/api/sessions/${currentSessionId}/shares`);
  if (listRes.ok) renderRecipients(await listRes.json());
}

export function initSharing(): void {
  const submit = () => {
    const input = el('share-email-input') as HTMLInputElement | null;
    if (input) void addShare(input.value);
  };
  el('btn-share-add')?.addEventListener('click', submit);
  el('btn-demo-share')?.addEventListener('click', () => void toggleDemo());
  el('share-email-input')?.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') {
      e.preventDefault();
      submit();
    }
  });
  // Delegate unshare clicks (recipient rows are rebuilt on each render).
  el('share-recipient-list')?.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest('.btn-unshare') as HTMLElement | null;
    if (btn) void removeShare(Number(btn.dataset['uid']));
  });
}
