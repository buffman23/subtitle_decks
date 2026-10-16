"""Card creation drafts, deck management and study, backed by AnkiConnect.

Endpoints that talk to Anki are plain `def` so FastAPI runs the blocking
AnkiConnect calls in its threadpool. Deck names travel as a `deck` query
parameter (they may contain "/", "?" etc.) and are always the user's *short*
name; anki_decks adds the per-user root.
"""
import logging
import mimetypes
import os
import re
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool

from app.dependencies import get_db
from app.models import CardDraft, User
from app.routers.api_sessions import _get_accessible_session, _require_user
from app.schemas import (
    AnkiDeckOut,
    AnkiNoteOut,
    CardDraftOut,
    CardDraftUpdate,
    DraftCard,
    DraftSubmitResult,
    StudyAnswerRequest,
)
from app.services import anki_decks, card_drafts
from app.services.anki_client import AnkiError, AnkiUnavailable
from app.services.anki_decks import CardContent

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/anki", tags=["anki"])


def _anki_call(fn, *args, **kwargs):
    """Run an Anki operation, mapping AnkiConnect failures to HTTP errors."""
    try:
        return fn(*args, **kwargs)
    except AnkiUnavailable as exc:
        logger.warning("AnkiConnect unavailable: %s", exc)
        raise HTTPException(status_code=503, detail="The Anki service is unavailable. Please try again later.")
    except AnkiError as exc:
        logger.error("AnkiConnect error: %s", exc)
        raise HTTPException(status_code=502, detail="Anki rejected the request.")


# ---------------------------------------------------------------------------
# Drafts
# ---------------------------------------------------------------------------

def _draft_out(d: CardDraft) -> CardDraftOut:
    return CardDraftOut(
        session_id=d.session_id,
        selected_lemmas=d.selected_lemmas or [],
        deck_name=d.deck_name,
        current_step=d.current_step,
        cards={k: DraftCard.model_validate(v) for k, v in (d.cards or {}).items()},
        updated_at=d.updated_at,
    )


def _find_draft(session_id: int, user: User, db: Session) -> CardDraft | None:
    return db.query(CardDraft).filter_by(session_id=session_id, user_id=user.id).one_or_none()


def _require_draft(session_id: int, request: Request, db: Session) -> tuple[User, CardDraft]:
    user = _require_user(request, db)
    _get_accessible_session(session_id, user, db)
    draft = _find_draft(session_id, user, db)
    if draft is None:
        raise HTTPException(status_code=404, detail="No card draft for this session.")
    return user, draft


@router.get("/drafts/{session_id}", response_model=CardDraftOut | None)
def get_draft(session_id: int, request: Request, db: Session = Depends(get_db)):
    user = _require_user(request, db)
    _get_accessible_session(session_id, user, db)
    draft = _find_draft(session_id, user, db)
    return _draft_out(draft) if draft else None


@router.put("/drafts/{session_id}", response_model=CardDraftOut)
def put_draft(session_id: int, payload: CardDraftUpdate, request: Request, db: Session = Depends(get_db)):
    user = _require_user(request, db)
    _get_accessible_session(session_id, user, db)
    draft = _find_draft(session_id, user, db)
    if draft is None:
        draft = CardDraft(session_id=session_id, user_id=user.id, selected_lemmas=[], cards={}, current_step=0)
        db.add(draft)
    if payload.selected_lemmas is not None:
        # De-duplicate, keeping table order.
        draft.selected_lemmas = list(dict.fromkeys(payload.selected_lemmas))
    if payload.deck_name is not None:
        draft.deck_name = payload.deck_name[: anki_decks.MAX_DECK_NAME_LEN]
    if payload.current_step is not None:
        draft.current_step = max(0, min(payload.current_step, len(draft.selected_lemmas)))
    if payload.cards is not None:
        selected = set(draft.selected_lemmas)
        draft.cards = {k: v.model_dump() for k, v in payload.cards.items() if k in selected}
    draft.updated_at = datetime.utcnow()
    db.commit()
    return _draft_out(draft)


@router.delete("/drafts/{session_id}", status_code=204)
def delete_draft(session_id: int, request: Request, db: Session = Depends(get_db)):
    user = _require_user(request, db)
    _get_accessible_session(session_id, user, db)
    draft = _find_draft(session_id, user, db)
    if draft is not None:
        db.delete(draft)
        db.commit()
    return Response(status_code=204)


async def _read_upload(kind: str, file: UploadFile) -> tuple[bytes, str]:
    """Validate an uploaded image/audio file; returns (data, mime)."""
    if kind == "image":
        types, limit = card_drafts.IMAGE_TYPES, card_drafts.MAX_IMAGE_BYTES
    elif kind == "audio":
        types, limit = card_drafts.AUDIO_TYPES, card_drafts.MAX_AUDIO_BYTES
    else:
        raise HTTPException(status_code=422, detail="kind must be 'image' or 'audio'.")
    mime = (file.content_type or "").split(";")[0].strip().lower()
    if mime not in types:
        raise HTTPException(status_code=415, detail=f"Unsupported {kind} type: {mime or 'unknown'}.")
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(status_code=413, detail=f"The {kind} must be at most {limit // (1024 * 1024)} MB.")
    if not data:
        raise HTTPException(status_code=422, detail="The file is empty.")
    return data, mime


@router.post("/drafts/{session_id}/media")
async def upload_draft_media(
    session_id: int,
    request: Request,
    kind: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    _, draft = _require_draft(session_id, request, db)
    data, mime = await _read_upload(kind, file)
    media_id = uuid.uuid4().hex
    path = card_drafts.media_path(draft.id, media_id, mime)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(data)
    return {"id": media_id, "name": (file.filename or kind)[:200], "mime": mime}


@router.get("/drafts/{session_id}/media/{media_id}")
def get_draft_media(session_id: int, media_id: str, request: Request, db: Session = Depends(get_db)):
    _, draft = _require_draft(session_id, request, db)
    found = card_drafts.find_media(draft.id, media_id)
    if found is None:
        raise HTTPException(status_code=404, detail="File not found.")
    path, mime = found
    return FileResponse(path, media_type=mime, headers={"Cache-Control": "private, max-age=86400"})


@router.delete("/drafts/{session_id}/media/{media_id}", status_code=204)
def delete_draft_media(session_id: int, media_id: str, request: Request, db: Session = Depends(get_db)):
    _, draft = _require_draft(session_id, request, db)
    found = card_drafts.find_media(draft.id, media_id)
    if found is not None:
        os.remove(found[0])
    return Response(status_code=204)


def _read_draft_media(draft: CardDraft, ref: dict | None) -> tuple[bytes, str] | None:
    if not ref:
        return None
    path = card_drafts.media_path(draft.id, ref.get("id", ""), ref.get("mime", ""))
    if path is None or not os.path.isfile(path):
        return None
    with open(path, "rb") as fh:
        return fh.read(), os.path.splitext(path)[1]


@router.post("/drafts/{session_id}/submit", response_model=DraftSubmitResult)
def submit_draft(session_id: int, request: Request, db: Session = Depends(get_db)):
    user, draft = _require_draft(session_id, request, db)
    deck = anki_decks.validate_deck_name(draft.deck_name or "")
    if not draft.selected_lemmas:
        raise HTTPException(status_code=422, detail="No words are selected.")

    cards: list[CardContent] = []
    uploads: list[tuple[str, bytes]] = []
    for i, lemma in enumerate(draft.selected_lemmas):
        c = (draft.cards or {}).get(lemma) or {}
        word, native = (c.get("word") or lemma).strip(), (c.get("native") or "").strip()
        if not word or not native:
            raise HTTPException(
                status_code=422,
                detail={"message": f'Card {i + 1} ("{lemma}") needs a native word.', "step": i + 1},
            )
        content = CardContent(
            word=word,
            native=native,
            example_foreign=c.get("example_foreign") or "",
            example_native=c.get("example_native") or "",
        )
        for kind in ("image", "audio"):
            media = _read_draft_media(draft, c.get(kind))
            if media:
                data, ext = media
                name = anki_decks.new_media_name(user, ext)
                uploads.append((name, data))
                setattr(content, kind, name)
        cards.append(content)

    def _submit():
        for name, data in uploads:
            anki_decks.store_media(name, data)
        return anki_decks.add_notes(user, deck, cards)

    added, skipped = _anki_call(_submit)
    db.delete(draft)
    db.commit()
    return DraftSubmitResult(deck=deck, added=added, skipped=skipped)


# ---------------------------------------------------------------------------
# Decks & notes
# ---------------------------------------------------------------------------

@router.get("/decks", response_model=list[AnkiDeckOut])
def list_decks(request: Request, db: Session = Depends(get_db)):
    user = _require_user(request, db)
    return _anki_call(anki_decks.list_decks, user)


@router.delete("/decks", status_code=204)
def delete_deck(request: Request, deck: str = Query(...), db: Session = Depends(get_db)):
    user = _require_user(request, db)
    _anki_call(anki_decks.require_deck, user, deck)
    _anki_call(anki_decks.delete_deck, user, deck)
    return Response(status_code=204)


@router.get("/decks/notes", response_model=list[AnkiNoteOut])
def deck_notes(request: Request, deck: str = Query(...), db: Session = Depends(get_db)):
    user = _require_user(request, db)
    return _anki_call(anki_decks.deck_notes, user, deck)


def _download_name(deck: str) -> str:
    return (re.sub(r'[^\w\- .]+', "_", deck).strip() or "deck") + ".apkg"


@router.get("/decks/export")
def export_deck(request: Request, deck: str = Query(...), db: Session = Depends(get_db)):
    user = _require_user(request, db)
    path = _anki_call(anki_decks.export_apkg, user, deck)
    if not os.path.isfile(path):
        logger.error("Anki export not found at %s (check ANKI_EXPORT_DIR_*)", path)
        raise HTTPException(status_code=500, detail="The export could not be read.")
    return FileResponse(
        path,
        media_type="application/octet-stream",
        filename=_download_name(deck),
        background=BackgroundTask(os.remove, path),
    )


@router.get("/decks/package")
def deck_package(request: Request, deck: str = Query(...), db: Session = Depends(get_db)):
    user = _require_user(request, db)
    return _anki_call(anki_decks.deck_package, user, deck)


@router.patch("/notes/{note_id}", response_model=AnkiNoteOut)
def update_note(note_id: int, payload: DraftCard, request: Request, db: Session = Depends(get_db)):
    """Replace a note's text fields; its image/audio are kept."""
    user = _require_user(request, db)
    if not payload.word.strip() or not payload.native.strip():
        raise HTTPException(status_code=422, detail="Foreign and native word are required.")

    def _update():
        current = anki_decks.get_note(user, note_id)
        anki_decks.update_note(user, note_id, CardContent(
            word=payload.word, native=payload.native,
            example_foreign=payload.example_foreign, example_native=payload.example_native,
            image=current["image"], audio=current["audio"],
        ))
        return anki_decks.get_note(user, note_id)

    return _anki_call(_update)


def _set_note_media(user: User, note_id: int, kind: str, name: str | None) -> dict:
    current = anki_decks.get_note(user, note_id)
    content = CardContent(**{k: v for k, v in current.items() if k != "note_id"})
    old = getattr(content, kind)
    setattr(content, kind, name)
    anki_decks.update_note(user, note_id, content)
    if old and old != name:
        anki_decks.delete_media(user, [old])
    return anki_decks.get_note(user, note_id)


@router.post("/notes/{note_id}/media", response_model=AnkiNoteOut)
async def replace_note_media(
    note_id: int,
    request: Request,
    kind: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    user = _require_user(request, db)
    data, mime = await _read_upload(kind, file)
    name = anki_decks.new_media_name(user, (card_drafts.IMAGE_TYPES | card_drafts.AUDIO_TYPES)[mime])

    def _replace():
        anki_decks.get_note(user, note_id)  # ownership check before storing anything
        anki_decks.store_media(name, data)
        return _set_note_media(user, note_id, kind, name)

    return await run_in_threadpool(_anki_call, _replace)


@router.delete("/notes/{note_id}/media/{kind}", response_model=AnkiNoteOut)
def remove_note_media(note_id: int, kind: str, request: Request, db: Session = Depends(get_db)):
    user = _require_user(request, db)
    if kind not in ("image", "audio"):
        raise HTTPException(status_code=422, detail="kind must be 'image' or 'audio'.")
    return _anki_call(_set_note_media, user, note_id, kind, None)


@router.delete("/notes/{note_id}", status_code=204)
def delete_note(note_id: int, request: Request, db: Session = Depends(get_db)):
    user = _require_user(request, db)
    _anki_call(anki_decks.delete_note, user, note_id)
    return Response(status_code=204)


@router.get("/media/{filename}")
def get_media(filename: str, request: Request, db: Session = Depends(get_db)):
    user = _require_user(request, db)
    data = _anki_call(anki_decks.retrieve_media, user, filename)
    if data is None:
        raise HTTPException(status_code=404, detail="File not found.")
    mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    return Response(data, media_type=mime, headers={"Cache-Control": "private, max-age=86400"})


# ---------------------------------------------------------------------------
# Study
# ---------------------------------------------------------------------------

@router.get("/study/next")
def study_next(request: Request, deck: str = Query(...), db: Session = Depends(get_db)):
    user = _require_user(request, db)
    return _anki_call(anki_decks.next_card, user, deck)


@router.post("/study/answer", status_code=204)
def study_answer(payload: StudyAnswerRequest, request: Request, db: Session = Depends(get_db)):
    user = _require_user(request, db)
    _anki_call(anki_decks.answer, user, payload.card_id, payload.ease)
    return Response(status_code=204)
