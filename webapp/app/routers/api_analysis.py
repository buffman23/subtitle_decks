import asyncio
import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy.orm import Session

from app.dependencies import get_db, get_current_user, resolve_language_id
from app.models import IgnoreListEntry
from app.schemas import JobStatusResponse, JobSubmitResponse
from app.services.app_settings import effective_max_upload_bytes
from app.services.job_queue import Job, manager, model_lock
from app.services.processor_registry import get_processor
from app.templating import humanize_bytes

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["analysis"])


@router.get("/models/{code}/status")
async def model_status(code: str):
    """Report whether the language model is already loaded in memory."""
    try:
        processor = get_processor(code)
    except ValueError:
        raise HTTPException(status_code=404, detail=f"Unknown language: {code!r}")
    return {"code": code, "loaded": processor.is_loaded()}


@router.post("/models/{code}/load")
async def ensure_model_loaded(code: str):
    """Load the language model on demand (analysis lazy-loads it anyway)."""
    try:
        processor = get_processor(code)
    except ValueError:
        raise HTTPException(status_code=404, detail=f"Unknown language: {code!r}")

    def _load():
        with model_lock:
            processor.load()

    await asyncio.to_thread(_load)
    return {"code": code, "loaded": processor.is_loaded()}


@router.post("/analyze", status_code=202, response_model=JobSubmitResponse)
async def analyze_srt(
    request: Request,
    file: UploadFile = File(...),
    language: str = Form("ar-msa"),
    ignore_list_text: str = Form(""),
    db: Session = Depends(get_db),
):
    """Enqueue an analysis job and return its id; results are polled separately."""
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    user = get_current_user(request, db)

    max_bytes = effective_max_upload_bytes(db, user)
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File is too large ({humanize_bytes(len(content))}). "
                   f"The maximum allowed size is {humanize_bytes(max_bytes)}.",
        )

    try:
        processor = get_processor(language)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Unknown language: {language!r}")

    # Parse plaintext ignore list (newline-separated lemmas)
    uploaded_words: list[str] = [w.strip() for w in ignore_list_text.splitlines() if w.strip()]
    ignore_set: set[str] = set(uploaded_words)

    if user:
        lang_id = resolve_language_id(language, db)
        # Save any uploaded words to the user's DB ignore list
        if uploaded_words:
            existing = {
                e.word for e in db.query(IgnoreListEntry)
                .filter(IgnoreListEntry.user_id == user.id, IgnoreListEntry.language_id == lang_id)
                .all()
            }
            new_entries = [
                IgnoreListEntry(user_id=user.id, word=w, language_id=lang_id)
                for w in uploaded_words if w not in existing
            ]
            if new_entries:
                db.bulk_save_objects(new_entries)
                db.commit()

        # Merge full DB ignore list into ignore_set
        for entry in (
            db.query(IgnoreListEntry)
            .filter(IgnoreListEntry.user_id == user.id, IgnoreListEntry.language_id == lang_id)
            .all()
        ):
            ignore_set.add(entry.word)

    job = manager.submit(Job(
        user_id=user.id if user else None,
        user_label=user.email if user else "Guest",
        language_code=language,
        language_name=processor.language_name,
        filename=file.filename or "subtitles.srt",
        content=content,
        ignore_set=ignore_set,
    ))
    return JobSubmitResponse(job_id=job.id, position=manager.position_of(job.id))


@router.get("/analyze/jobs/{job_id}", response_model=JobStatusResponse)
async def analyze_job_status(job_id: str, request: Request, db: Session = Depends(get_db)):
    """Poll a job's status; the full result is returned once it's done."""
    job = manager.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")

    # A job tied to an account is visible only to its owner or an admin. Guest
    # jobs (user_id None) are guarded by the unguessable job id itself.
    if job.user_id is not None:
        user = get_current_user(request, db)
        if user is None or (user.id != job.user_id and not user.is_admin):
            raise HTTPException(status_code=404, detail="Job not found.")

    return JobStatusResponse(
        status=job.status,
        position=manager.position_of(job.id),
        result=job.result if job.status == "done" else None,
        error=job.error,
        session_id=job.session_id,
        session_name=job.session_name,
    )


@router.post("/analyze/jobs/{job_id}/cancel")
async def cancel_analyze_job(job_id: str, request: Request, db: Session = Depends(get_db)):
    """Cancel one's own queued or running analysis. Lenient: finishing jobs are
    a no-op (the poll will report the real outcome)."""
    job = manager.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")

    if job.user_id is not None:
        user = get_current_user(request, db)
        if user is None or (user.id != job.user_id and not user.is_admin):
            raise HTTPException(status_code=404, detail="Job not found.")

    if job.status not in ("done", "failed", "cancelled"):
        manager.cancel(job)
    return {"id": job.id, "status": job.status}
