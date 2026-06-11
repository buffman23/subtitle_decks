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

  // --- Edit a user's per-account upload limit ---
  if (target.classList.contains("btn-edit-limit")) {
    const row = target.closest("tr");
    const userId = row.dataset.userId;
    const email = target.dataset.email || "this account";
    const current = target.dataset.currentKb || "";
    const input = window.prompt(
      `Upload limit for ${email}, in KB.\nLeave blank to use the global default.`,
      current
    );
    if (input === null) return; // cancelled
    const trimmed = input.trim();
    let body;
    if (trimmed === "") {
      body = { max_upload_kb: null };
    } else {
      const kb = parseInt(trimmed, 10);
      if (isNaN(kb) || kb < 1) {
        alert("Please enter a whole number of KB (at least 1), or leave blank for the default.");
        return;
      }
      body = { max_upload_kb: kb };
    }
    target.disabled = true;
    try {
      const data = await postJSON(`/api/admin/accounts/${userId}/upload-limit`, body);
      const label = row.querySelector(".upload-limit");
      if (data.max_upload_bytes) {
        label.textContent = humanizeBytes(data.max_upload_bytes);
        target.dataset.currentKb = Math.round(data.max_upload_bytes / 1024);
      } else {
        label.innerHTML = `${humanizeBytes(data.effective_bytes)} <span class="text-muted">(default)</span>`;
        target.dataset.currentKb = "";
      }
    } catch (err) {
      alert(`Could not update upload limit: ${err.message}`);
    } finally {
      target.disabled = false;
    }
    return;
  }

  // --- Cancel a queued/running analysis job ---
  if (target.classList.contains("btn-cancel-job")) {
    const jobId = target.dataset.jobId;
    if (!confirm("Cancel this analysis job?")) return;
    target.disabled = true;
    try {
      await postJSON(`/api/admin/queue/${jobId}/cancel`);
      await renderQueue();
    } catch (err) {
      alert(`Could not cancel job: ${err.message}`);
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

// --- Analysis queue page: poll + render ---------------------------------
const QUEUE_BADGE = {
  queued: "text-bg-secondary",
  running: "text-bg-primary",
  done: "text-bg-success",
  failed: "text-bg-danger",
  cancelled: "text-bg-dark",
};

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function formatTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d) ? "—" : d.toLocaleString();
}

async function renderQueue() {
  const tbody = document.getElementById("queue-tbody");
  if (!tbody) return;
  let jobs;
  try {
    const res = await fetch("/api/admin/queue");
    if (!res.ok) throw new Error(res.statusText);
    jobs = await res.json();
  } catch (e) {
    return; // transient; the next poll will retry
  }
  if (!jobs.length) {
    tbody.innerHTML =
      '<tr><td colspan="7" class="text-center text-muted py-4">No jobs yet.</td></tr>';
    return;
  }
  tbody.innerHTML = jobs
    .map((j) => {
      const badge = QUEUE_BADGE[j.status] || "text-bg-secondary";
      const pos =
        j.status === "queued" && j.position
          ? j.position
          : j.status === "running"
          ? '<i class="bi bi-play-fill"></i>'
          : '<span class="text-muted">—</span>';
      const cancellable = j.status === "queued" || j.status === "running";
      const action = cancellable
        ? `<button class="btn btn-sm btn-outline-danger btn-cancel-job" data-job-id="${escapeHtml(
            j.id
          )}">Cancel</button>`
        : '<span class="text-muted">—</span>';
      return `<tr>
        <td class="text-center">${pos}</td>
        <td>${escapeHtml(j.user_label)}</td>
        <td><code>${escapeHtml(j.language_code)}</code></td>
        <td class="text-truncate" style="max-width: 16rem">${escapeHtml(j.filename)}</td>
        <td class="text-center"><span class="badge ${badge}">${escapeHtml(j.status)}</span></td>
        <td>${formatTime(j.created_at)}</td>
        <td class="text-end">${action}</td>
      </tr>`;
    })
    .join("");
}

if (document.getElementById("queue-tbody")) {
  renderQueue();
  setInterval(renderQueue, 2000);
}

// --- General settings page: save form -----------------------------------
const settingsForm = document.getElementById("settings-form");
if (settingsForm) {
  settingsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const saveBtn = document.getElementById("settings-save");
    const status = document.getElementById("settings-status");
    const maxUploadKb = parseInt(document.getElementById("max-upload-kb").value, 10);
    saveBtn.disabled = true;
    if (status) { status.textContent = ""; status.className = "small"; }
    try {
      const data = await postJSON("/api/admin/settings", { max_upload_kb: maxUploadKb });
      document.getElementById("max-upload-kb").value = data.max_upload_kb;
      if (status) { status.textContent = "Saved."; status.className = "small text-success"; }
    } catch (err) {
      if (status) { status.textContent = `Could not save: ${err.message}`; status.className = "small text-danger"; }
    } finally {
      saveBtn.disabled = false;
    }
  });
}

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
