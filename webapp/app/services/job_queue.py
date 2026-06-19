"""In-process analysis job queue.

A single worker drains a FIFO queue and runs one analysis at a time, dispatching
the blocking work to a threadpool so the event loop stays responsive. The same
``model_lock`` guards every model load/unload/use so the worker and the admin
load/unload endpoints never touch the shared model cache concurrently.

Everything is in memory and process-local (the model caches are too — see the
single-worker note in main.py). The finished-job log is capped and resets on
restart.
"""

import asyncio
import logging
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

from app.services.frequency_analyzer import analyze
from app.services.language_processor import CancelledAnalysis, LemmatizationUnavailable

logger = logging.getLogger(__name__)

# Statuses that mean the job is no longer queued or running.
_FINISHED = {"done", "failed", "cancelled"}
# How many finished jobs to retain as the admin "log".
_MAX_FINISHED = 50

# Guards all model load/unload/inference against the process-local model caches.
model_lock = threading.Lock()


def _now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class Job:
    user_id: int | None
    user_label: str
    language_code: str
    language_name: str
    filename: str
    content: bytes
    ignore_set: set[str]
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    status: str = "queued"  # queued | running | done | failed | cancelled
    created_at: datetime = field(default_factory=_now)
    started_at: datetime | None = None
    finished_at: datetime | None = None
    error: str | None = None
    result: dict | None = None
    cancel_event: threading.Event = field(default_factory=threading.Event)


def _run_job(job: Job) -> dict:
    """Blocking analysis, run in a threadpool thread under the model lock."""
    with model_lock:
        results, total_unique, total_tokens, subtitles = analyze(
            job.content,
            job.language_code,
            job.ignore_set,
            should_cancel=job.cancel_event.is_set,
        )
    return {
        "results": results,
        "total_unique": total_unique,
        "total_tokens": total_tokens,
        "subtitles": subtitles,
    }


class JobQueueManager:
    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}  # insertion order = FIFO submit order
        self._queue: asyncio.Queue[str] | None = None
        self._worker: asyncio.Task | None = None
        self._running_job: Job | None = None

    # --- lifecycle -------------------------------------------------------
    def start(self) -> None:
        self._queue = asyncio.Queue()
        self._worker = asyncio.create_task(self._run_worker(), name="analysis-worker")
        logger.info("Analysis job queue worker started")

    async def stop(self) -> None:
        if self._worker is not None:
            self._worker.cancel()
            try:
                await self._worker
            except asyncio.CancelledError:
                pass
            self._worker = None
            logger.info("Analysis job queue worker stopped")

    # --- public API (called on the event loop) ---------------------------
    def submit(self, job: Job) -> Job:
        assert self._queue is not None, "queue worker not started"
        self._jobs[job.id] = job
        self._queue.put_nowait(job.id)
        self._trim_finished()
        return job

    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    def position_of(self, job_id: str) -> int | None:
        """1-based position among queued jobs, or None if not queued."""
        pos = 0
        for job in self._jobs.values():
            if job.status == "queued":
                pos += 1
                if job.id == job_id:
                    return pos
        return None

    def model_in_use(self, language_code: str) -> bool:
        rj = self._running_job
        return rj is not None and rj.language_code == language_code

    def list_jobs(self) -> list[Job]:
        """Active jobs (FIFO) first, then finished jobs newest-first."""
        active = [j for j in self._jobs.values() if j.status not in _FINISHED]
        finished = [j for j in self._jobs.values() if j.status in _FINISHED]
        finished.sort(key=lambda j: j.finished_at or j.created_at, reverse=True)
        return active + finished

    def cancel(self, job: Job) -> None:
        """Request cancellation. Queued jobs are finalized immediately; a
        running job is flagged and stops at the next cancellation checkpoint."""
        job.cancel_event.set()
        if job.status == "queued":
            job.status = "cancelled"
            job.finished_at = _now()
            self._trim_finished()

    # --- worker ----------------------------------------------------------
    async def _run_worker(self) -> None:
        assert self._queue is not None
        loop = asyncio.get_running_loop()
        while True:
            job_id = await self._queue.get()
            job = self._jobs.get(job_id)
            try:
                if job is None or job.status != "queued":
                    continue  # cancelled or trimmed while queued
                job.status = "running"
                job.started_at = _now()
                self._running_job = job
                try:
                    result = await loop.run_in_executor(None, _run_job, job)
                    if job.cancel_event.is_set():
                        job.status = "cancelled"
                    else:
                        job.result = result
                        job.status = "done"
                except CancelledAnalysis:
                    job.status = "cancelled"
                except LemmatizationUnavailable as exc:
                    # Model/lemmatization failure — show the processor's user-facing
                    # message rather than the generic one (it explains what went wrong).
                    logger.warning("Analysis job %s failed: %s", job.id, exc)
                    job.status = "failed"
                    job.error = str(exc)
                except Exception as exc:  # noqa: BLE001 — surface to the user
                    logger.exception("Analysis job %s failed: %s", job.id, exc)
                    job.status = "failed"
                    job.error = "Analysis failed."
                finally:
                    job.finished_at = _now()
                    self._running_job = None
                    self._trim_finished()
            finally:
                self._queue.task_done()

    # --- internals -------------------------------------------------------
    def _trim_finished(self) -> None:
        finished_ids = [jid for jid, j in self._jobs.items() if j.status in _FINISHED]
        excess = len(finished_ids) - _MAX_FINISHED
        for jid in finished_ids[:excess] if excess > 0 else []:
            self._jobs.pop(jid, None)


manager = JobQueueManager()
