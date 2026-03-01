from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.dependencies import get_db, get_current_user
from app.models import IgnoreListEntry, Language
from app.schemas import IgnoreListEntryOut, IgnoreListAddRequest


def _lang_id(code: str) -> int:
    try:
        return Language.from_code(code)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Unknown language: {code!r}")

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
        .filter(IgnoreListEntry.user_id == user.id, IgnoreListEntry.language == _lang_id(language))
        .all()
    )


@router.post("/add", response_model=IgnoreListEntryOut)
async def add_to_ignore_list(
    request: Request,
    payload: IgnoreListAddRequest,
    db: Session = Depends(get_db),
):
    user = _require_user(request, db)
    lang_id = _lang_id(payload.language)
    entry = IgnoreListEntry(user_id=user.id, word=payload.word, language=lang_id)
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
                IgnoreListEntry.language == lang_id,
            )
            .first()
        )
    return entry


@router.post("/import")
async def import_ignore_list(
    request: Request,
    language: str = Form("ar-msa"),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    user = _require_user(request, db)
    content = await file.read()
    words = [w.strip() for w in content.decode("utf-8", errors="replace").splitlines() if w.strip()]
    lang_id = _lang_id(language)
    existing = {
        e.word for e in db.query(IgnoreListEntry)
        .filter(IgnoreListEntry.user_id == user.id, IgnoreListEntry.language == lang_id)
        .all()
    }
    new_entries = [
        IgnoreListEntry(user_id=user.id, word=w, language=lang_id)
        for w in words if w not in existing
    ]
    if new_entries:
        db.bulk_save_objects(new_entries)
        db.commit()
    return {"imported": len(new_entries), "skipped": len(words) - len(new_entries)}


@router.post("/remove", status_code=204)
async def remove_from_ignore_list_by_word(
    request: Request,
    payload: IgnoreListAddRequest,
    db: Session = Depends(get_db),
):
    user = _require_user(request, db)
    entry = (
        db.query(IgnoreListEntry)
        .filter(
            IgnoreListEntry.user_id == user.id,
            IgnoreListEntry.word == payload.word,
            IgnoreListEntry.language == _lang_id(payload.language),
        )
        .first()
    )
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found.")
    db.delete(entry)
    db.commit()
    return Response(status_code=204)


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
        .filter(IgnoreListEntry.user_id == user.id, IgnoreListEntry.language == _lang_id(language))
        .all()
    )
    data = "\n".join(e.word for e in entries)
    return Response(
        content=data,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="ignorelist_{language}.txt"'},
    )
