import json

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.dependencies import get_db, get_current_user
from app.models import BlacklistEntry
from app.schemas import BlacklistAddRequest, BlacklistEntryOut

router = APIRouter(prefix="/api/blacklist", tags=["blacklist"])


def _require_user(request: Request, db: Session):
    user = get_current_user(request, db)
    if user is None:
        raise HTTPException(status_code=401, detail="Login required.")
    return user


@router.get("", response_model=list[BlacklistEntryOut])
async def get_blacklist(
    request: Request,
    language: str = "ar",
    db: Session = Depends(get_db),
):
    user = _require_user(request, db)
    entries = (
        db.query(BlacklistEntry)
        .filter(BlacklistEntry.user_id == user.id, BlacklistEntry.language == language)
        .all()
    )
    return entries


@router.post("/add", response_model=BlacklistEntryOut)
async def add_to_blacklist(
    request: Request,
    payload: BlacklistAddRequest,
    db: Session = Depends(get_db),
):
    user = _require_user(request, db)
    entry = BlacklistEntry(user_id=user.id, word=payload.word, language=payload.language)
    db.add(entry)
    try:
        db.commit()
        db.refresh(entry)
    except IntegrityError:
        db.rollback()
        # Already exists — return it
        entry = (
            db.query(BlacklistEntry)
            .filter(
                BlacklistEntry.user_id == user.id,
                BlacklistEntry.word == payload.word,
                BlacklistEntry.language == payload.language,
            )
            .first()
        )
    return entry


@router.delete("/{entry_id}", status_code=204)
async def remove_from_blacklist(
    entry_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    user = _require_user(request, db)
    entry = db.get(BlacklistEntry, entry_id)
    if entry is None or entry.user_id != user.id:
        raise HTTPException(status_code=404, detail="Entry not found.")
    db.delete(entry)
    db.commit()
    return Response(status_code=204)


@router.get("/export")
async def export_blacklist(
    request: Request,
    language: str = "ar",
    db: Session = Depends(get_db),
):
    user = _require_user(request, db)
    entries = (
        db.query(BlacklistEntry)
        .filter(BlacklistEntry.user_id == user.id, BlacklistEntry.language == language)
        .all()
    )
    data = json.dumps([e.word for e in entries], ensure_ascii=False, indent=2)
    return Response(
        content=data,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="blacklist_{language}.json"'},
    )
