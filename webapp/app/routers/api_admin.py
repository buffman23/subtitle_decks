import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.dependencies import get_db, require_admin
from app.models import User
from app.schemas import (
    AdminToggleRequest,
    AutoUnloadRequest,
    GeneralSettingsRequest,
    QueueJobOut,
    UserUploadLimitRequest,
)
from app.services.app_settings import (
    get_github_url,
    get_max_upload_bytes,
    set_github_url,
    set_max_upload_bytes,
)
from app.services.job_queue import manager, model_lock
from app.services.processor_registry import get_processor

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin-api"])


@router.delete("/accounts/{user_id}", status_code=204)
async def delete_account(
    user_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account.")
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Account not found.")
    db.delete(target)  # cascades sessions + ignore-list entries
    db.commit()
    return Response(status_code=204)


@router.post("/accounts/{user_id}/admin")
async def set_admin(
    user_id: int,
    payload: AdminToggleRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if user_id == admin.id and not payload.is_admin:
        raise HTTPException(status_code=400, detail="You cannot remove your own admin access.")
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Account not found.")
    target.is_admin = payload.is_admin
    db.commit()
    return {"id": target.id, "is_admin": target.is_admin}


@router.post("/accounts/{user_id}/upload-limit")
async def set_upload_limit(
    user_id: int,
    payload: UserUploadLimitRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Account not found.")
    target.max_upload_bytes = (
        payload.max_upload_kb * 1024 if payload.max_upload_kb is not None else None
    )
    db.commit()
    return {
        "id": target.id,
        "max_upload_bytes": target.max_upload_bytes,
        "effective_bytes": get_max_upload_bytes(db)
        if target.max_upload_bytes is None
        else target.max_upload_bytes,
    }


@router.post("/models/{code}/load")
async def load_model(code: str, admin: User = Depends(require_admin)):
    return await _set_model(code, load=True)


@router.post("/models/{code}/unload")
async def unload_model(code: str, admin: User = Depends(require_admin)):
    return await _set_model(code, load=False)


async def _set_model(code: str, load: bool) -> dict:
    try:
        processor = get_processor(code)
    except ValueError:
        raise HTTPException(status_code=404, detail=f"Unknown language: {code!r}")

    # Don't pull a model out from under a running analysis.
    if not load and manager.model_in_use(code):
        raise HTTPException(
            status_code=409,
            detail="Cannot unload: model is in use by a running analysis.",
        )

    # Run the blocking load/unload off the event loop, serialized with the
    # analysis worker via the shared model lock.
    def _apply():
        with model_lock:
            if load:
                processor.load()
            else:
                processor.unload()

    await asyncio.to_thread(_apply)
    status = "loaded" if processor.is_loaded() else "unloaded"
    return {"code": code, "status": status, "ram_bytes": processor.ram_bytes()}


@router.get("/queue", response_model=list[QueueJobOut])
async def list_queue(admin: User = Depends(require_admin)):
    return [
        QueueJobOut(
            id=job.id,
            user_label=job.user_label,
            language_code=job.language_code,
            language_name=job.language_name,
            filename=job.filename,
            status=job.status,
            position=manager.position_of(job.id),
            created_at=job.created_at,
            started_at=job.started_at,
            finished_at=job.finished_at,
        )
        for job in manager.list_jobs()
    ]


@router.post("/queue/{job_id}/cancel")
async def cancel_queue_job(job_id: str, admin: User = Depends(require_admin)):
    job = manager.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    if job.status in {"done", "failed", "cancelled"}:
        raise HTTPException(status_code=409, detail="Job has already finished.")
    manager.cancel(job)
    return {"id": job.id, "status": job.status}


@router.get("/settings")
async def get_settings(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    return _settings_out(db)


@router.post("/settings")
async def update_settings(
    payload: GeneralSettingsRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    set_max_upload_bytes(db, payload.max_upload_kb * 1024)
    if payload.github_url is not None:
        set_github_url(db, payload.github_url)
    return _settings_out(db)


def _settings_out(db: Session) -> dict:
    return {
        "max_upload_kb": get_max_upload_bytes(db) // 1024,
        "github_url": get_github_url(db),
    }


@router.post("/models/{code}/auto-unload")
async def set_auto_unload(
    code: str,
    payload: AutoUnloadRequest,
    admin: User = Depends(require_admin),
):
    try:
        processor = get_processor(code)
    except ValueError:
        raise HTTPException(status_code=404, detail=f"Unknown language: {code!r}")
    processor.auto_unload = payload.enabled
    return {
        "code": code,
        "auto_unload": processor.auto_unload,
        "ram_bytes": processor.ram_bytes(),
    }
