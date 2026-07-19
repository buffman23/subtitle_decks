"use strict";

// Cross-page analysis notifier.
//
// A finished analysis is now saved server-side on job completion, so the user
// can start one and wander off. This tiny script — loaded on EVERY page via
// base.html — watches the shared pending-job list and pops a toast (linking to
// the saved session) when a job the user navigated away from finishes.
//
// It deliberately stays inert on the main app page: app.js owns the full job
// lifecycle there (in-page progress + its own "saved" toast) and sets
// window.SUBTITLE_DECKS_APP. base.html loads this script AFTER the page's own
// scripts, so that flag is already set by the time we run.
(function () {
  if (window.SUBTITLE_DECKS_APP) return;        // the app bundle handles this page
  if (!window.SUBTITLE_DECKS_LOGGED_IN) return; // only logged-in jobs are tracked/saved

  var KEY = "subtitleDecks.pendingJobs"; // shared with src/features/analyze.ts
  var POLL_MS = 2500;
  var MAX_AGE_MS = 3 * 60 * 60 * 1000; // forget stuck/orphaned entries after 3h

  function readJobs() {
    try { return JSON.parse(localStorage.getItem(KEY) || "[]"); }
    catch (e) { return []; }
  }
  function writeJobs(jobs) {
    try { localStorage.setItem(KEY, JSON.stringify(jobs)); }
    catch (e) { /* storage unavailable */ }
  }
  function removeJob(jobId) {
    writeJobs(readJobs().filter(function (j) { return j.jobId !== jobId; }));
  }

  // A toast styled like the app's flash() helper. If href is given the whole
  // toast is clickable. Auto-dismisses after ~9s (longer than a plain flash so
  // there's time to click through).
  function toast(message, type, href) {
    var container = document.getElementById("flash-container");
    if (!container) return;
    var el = document.createElement("div");
    el.className = "alert alert-" + (type || "success") + " flash-alert shadow";
    el.textContent = message;
    if (href) {
      el.style.cursor = "pointer";
      el.addEventListener("click", function () { window.location.href = href; });
    }
    container.appendChild(el);
    setTimeout(function () { el.remove(); }, 9000);
  }

  var inFlight = {}; // jobId -> true, so overlapping ticks don't double-poll

  function pollOne(entry) {
    if (inFlight[entry.jobId]) return;
    inFlight[entry.jobId] = true;
    fetch("/api/analyze/jobs/" + encodeURIComponent(entry.jobId))
      .then(function (res) {
        if (res.status === 404) {
          // Gone from the server's in-memory job log (completed & trimmed, or a
          // restart). It was almost certainly saved — point at the sessions list.
          removeJob(entry.jobId);
          toast("An analysis finished while you were away — open it in My Sessions.", "info", "/");
          return null;
        }
        return res.ok ? res.json() : null; // non-ok: transient, retry next tick
      })
      .then(function (job) {
        if (!job) return;
        if (job.status === "done") {
          removeJob(entry.jobId);
          var name = job.session_name || entry.filename;
          var href = job.session_id ? "/?session=" + job.session_id : "/";
          toast('Analysis of "' + name + '" is ready.', "success", href);
        } else if (job.status === "failed") {
          removeJob(entry.jobId);
          toast(job.error || ('Analysis of "' + entry.filename + '" failed.'), "danger");
        } else if (job.status === "cancelled") {
          removeJob(entry.jobId);
        }
        // queued / running: leave it and poll again next tick.
      })
      .catch(function () { /* network hiccup; retry next tick */ })
      .then(function () { delete inFlight[entry.jobId]; });
  }

  function tick() {
    var jobs = readJobs();
    if (!jobs.length) return;
    var now = Date.now();
    var fresh = jobs.filter(function (j) { return now - (j.addedAt || 0) < MAX_AGE_MS; });
    if (fresh.length !== jobs.length) writeJobs(fresh);
    fresh.forEach(pollOne);
  }

  tick();
  setInterval(tick, POLL_MS);
})();
