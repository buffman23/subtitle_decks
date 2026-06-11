"use strict";

// Mirror of the server-side humanize_bytes (B / KB / MB / GB).
function humanizeBytes(num) {
  let size = Number(num) || 0;
  const units = ["B", "KB", "MB", "GB"];
  for (let i = 0; i < units.length; i++) {
    if (size < 1024 || i === units.length - 1) {
      return size.toFixed(i === 0 ? 0 : 1) + " " + units[i];
    }
    size /= 1024;
  }
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch (e) {}
    throw new Error(detail);
  }
  return res.status === 204 ? null : res.json();
}

document.addEventListener("click", async (e) => {
  const target = e.target.closest("button");
  if (!target) return;

  // --- Delete account ---
  if (target.classList.contains("btn-delete-account")) {
    const row = target.closest("tr");
    const userId = row.dataset.userId;
    const email = target.dataset.email || "this account";
    if (!confirm(`Delete ${email}? This removes all their saved sessions and ignore lists.`)) return;
    target.disabled = true;
    try {
      const res = await fetch(`/api/admin/accounts/${userId}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        let detail = res.statusText;
        try { detail = (await res.json()).detail || detail; } catch (e) {}
        throw new Error(detail);
      }
      row.remove();
    } catch (err) {
      alert(`Could not delete account: ${err.message}`);
      target.disabled = false;
    }
    return;
  }

  // --- Toggle admin ---
  if (target.classList.contains("btn-toggle-admin")) {
    const row = target.closest("tr");
    const userId = row.dataset.userId;
    const makeAdmin = target.dataset.makeAdmin === "true";
    const email = target.dataset.email || "this account";
    const prompt = makeAdmin
      ? `Make ${email} an admin? They will gain full admin access.`
      : `Remove admin from ${email}?`;
    if (!confirm(prompt)) return;
    target.disabled = true;
    try {
      const data = await postJSON(`/api/admin/accounts/${userId}/admin`, { is_admin: makeAdmin });
      const badge = row.querySelector(".admin-badge");
      badge.textContent = data.is_admin ? "Admin" : "User";
      badge.classList.toggle("text-bg-success", data.is_admin);
      badge.classList.toggle("text-bg-secondary", !data.is_admin);
      target.dataset.makeAdmin = data.is_admin ? "false" : "true";
      target.textContent = data.is_admin ? "Remove admin" : "Make admin";
    } catch (err) {
      alert(`Could not update admin status: ${err.message}`);
    } finally {
      target.disabled = false;
    }
    return;
  }

  // (model auto-unload is a checkbox — handled by the change listener below)

  // --- Load / unload model ---
  if (target.classList.contains("btn-toggle-model")) {
    const row = target.closest("tr");
    const code = row.dataset.modelCode;
    const action = target.dataset.action; // "load" | "unload"
    const original = target.textContent;
    target.disabled = true;
    target.textContent = action === "load" ? "Loading…" : "Unloading…";
    try {
      const data = await postJSON(`/api/admin/models/${code}/${action}`);
      const badge = row.querySelector(".model-status");
      const loaded = data.status === "loaded";
      badge.textContent = data.status;
      badge.classList.toggle("text-bg-success", loaded);
      badge.classList.toggle("text-bg-secondary", !loaded);
      target.dataset.action = loaded ? "unload" : "load";
      target.textContent = loaded ? "Unload" : "Load";
      target.classList.toggle("btn-outline-secondary", loaded);
      target.classList.toggle("btn-outline-success", !loaded);
      const ramCell = row.querySelector(".model-ram");
      if (ramCell) {
        ramCell.innerHTML = data.ram_bytes
          ? humanizeBytes(data.ram_bytes)
          : '<span class="text-muted">—</span>';
      }
    } catch (err) {
      alert(`Could not ${action} model: ${err.message}`);
      target.textContent = original;
    } finally {
      target.disabled = false;
    }
    return;
  }
});

// --- Toggle a model's auto-unload-after-analysis setting ---
document.addEventListener("change", async (e) => {
  const input = e.target.closest(".model-autounload");
  if (!input) return;
  const row = input.closest("tr");
  const code = row.dataset.modelCode;
  input.disabled = true;
  try {
    const data = await postJSON(`/api/admin/models/${code}/auto-unload`, { enabled: input.checked });
    // RAM isn't measured while auto-unload is on, so reflect that immediately.
    const ramCell = row.querySelector(".model-ram");
    if (ramCell) {
      ramCell.innerHTML = data.ram_bytes
        ? humanizeBytes(data.ram_bytes)
        : '<span class="text-muted">—</span>';
    }
  } catch (err) {
    alert(`Could not update auto-unload: ${err.message}`);
    input.checked = !input.checked; // revert on failure
  } finally {
    input.disabled = false;
  }
});
