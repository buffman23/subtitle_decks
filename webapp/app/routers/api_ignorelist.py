from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.dependencies import get_db, get_current_user
from app.models import IgnoreListEntry
from app.schemas import IgnoreListEntryOut, IgnoreListAddRequest

router = APIRouter(prefix="/api/ignorelist", tags=["ignorelist"])


def _require_user(request: Request, db: Session):
    user = get_current_user(request, db)
    if user is None:
        raise HTTPException(status_code=401, detail="Login required.")
    return user


@router.get("", response_model=list[IgnoreListEntryOut])
async def get_ignore_list(
    request: Request,
    language: str = "ar-msa",
    db: Session = Depends(get_db),
):
    user = _require_user(request, db)
    return (
        db.query(IgnoreListEntry)
        .filter(IgnoreListEntry.user_id == user.id, IgnoreListEntry.language == language)
        .all()
    )


@router.post("/add", response_model=IgnoreListEntryOut)
async def add_to_ignore_list(
    request: Request,
    payload: IgnoreListAddRequest,
    db: Session = Depends(get_db),
):
    user = _require_user(request, db)
    entry = IgnoreListEntry(user_id=user.id, word=payload.word, language=payload.language)
    db.add(entry)
    try:
        db.commit()
        db.refresh(entry)
    except IntegrityError:
        db.rollback()
        entry = (
            db.query(IgnoreListEntry)
            .filter(
                IgnoreListEntry.user_id == user.id,
                IgnoreListEntry.word == payload.word,
                IgnoreListEntry.language == payload.language,
            )
            .first()
        )
    return entry


@router.delete("/{entry_id}", status_code=204)
async def remove_from_ignore_list(
    entry_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    user = _require_user(request, db)
    entry = db.get(IgnoreListEntry, entry_id)
    if entry is None or entry.user_id != user.id:
        raise HTTPException(status_code=404, detail="Entry not found.")
    db.delete(entry)
    db.commit()
    return Response(status_code=204)


@router.get("/export")
async def export_ignore_list(
    request: Request,
    language: str = "ar-msa",
    db: Session = Depends(get_db),
):
    user = _require_user(request, db)
    entries = (
        db.query(IgnoreListEntry)
        .filter(IgnoreListEntry.user_id == user.id, IgnoreListEntry.language == language)
        .all()
    )
    data = "\n".join(e.word for e in entries)
    return Response(
        content=data,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="ignorelist_{language}.txt"'},
    )
