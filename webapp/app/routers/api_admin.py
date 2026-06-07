import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.dependencies import get_db, require_admin
from app.models import User
from app.schemas import AdminToggleRequest
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


@router.post("/models/{code}/load")
async def load_model(code: str, admin: User = Depends(require_admin)):
    return {"code": code, "status": _set_model(code, load=True)}


@router.post("/models/{code}/unload")
async def unload_model(code: str, admin: User = Depends(require_admin)):
    return {"code": code, "status": _set_model(code, load=False)}


def _set_model(code: str, load: bool) -> str:
    try:
        processor = get_processor(code)
    except ValueError:
        raise HTTPException(status_code=404, detail=f"Unknown language: {code!r}")
    if load:
        processor.load()
    else:
        processor.unload()
    return "loaded" if processor.is_loaded() else "unloaded"
