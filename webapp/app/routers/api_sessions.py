import os
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.dependencies import get_db, get_current_user, resolve_language_id
from app.models import AnalysisSession
from app.schemas import SessionCreateRequest, SessionDetail, SessionNativeSubtitlesRequest, SessionOut, SessionRenameRequest

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


def _require_user(request: Request, db: Session):
    user = get_current_user(request, db)
    if user is None:
        raise HTTPException(status_code=401, detail="Login required.")
    return user


@router.get("", response_model=list[SessionOut])
async def list_sessions(
    request: Request,
    db: Session = Depends(get_db),
    language: Optional[str] = Query(None),
):
    user = _require_user(request, db)
    q = db.query(AnalysisSession).filter(AnalysisSession.user_id == user.id)
    if language:
        lang_id = resolve_language_id(language, db)
        q = q.filter(AnalysisSession.language_id == lang_id)
    sessions = q.order_by(AnalysisSession.created_at.desc()).all()
    return sessions


@router.get("/{session_id}", response_model=SessionDetail)
async def get_session(session_id: int, request: Request, db: Session = Depends(get_db)):
    user = _require_user(request, db)
    session = db.get(AnalysisSession, session_id)
    if session is None or session.user_id != user.id:
        raise HTTPException(status_code=404, detail="Session not found.")
    return session


@router.post("", response_model=SessionOut, status_code=201)
async def create_session(
    payload: SessionCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    user = _require_user(request, db)
    lang_id = resolve_language_id(payload.language, db)
    base_name = os.path.splitext(payload.srt_filename)[0]
    name = base_name
    existing = {
        s.name
        for s in db.query(AnalysisSession.name).filter(
            AnalysisSession.user_id == user.id,
            AnalysisSession.language_id == lang_id,
        )
    }
    if name in existing:
        counter = 2
        while f"{base_name} ({counter})" in existing:
            counter += 1
        name = f"{base_name} ({counter})"
    session = AnalysisSession(
        user_id=user.id,
        name=name,
        language_id=lang_id,
        srt_filename=payload.srt_filename,
        subtitles=[s.model_dump() for s in payload.subtitles],
        native_subtitles=[s.model_dump() for s in payload.native_subtitles] or None,
        results=[r.model_dump() for r in payload.results],
        created_at=datetime.utcnow(),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.patch("/{session_id}", response_model=SessionOut)
async def rename_session(
    session_id: int,
    payload: SessionRenameRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    user = _require_user(request, db)
    session = db.get(AnalysisSession, session_id)
    if session is None or session.user_id != user.id:
        raise HTTPException(status_code=404, detail="Session not found.")
    new_name = payload.name.strip() or session.name
    if new_name != session.name:
        conflict = db.query(AnalysisSession).filter(
            AnalysisSession.user_id == user.id,
            AnalysisSession.language_id == session.language_id,
            AnalysisSession.name == new_name,
        ).first()
        if conflict:
            raise HTTPException(status_code=409, detail="A session with that name already exists.")
    session.name = new_name
    db.commit()
    db.refresh(session)
    return session


@router.put("/{session_id}/native-subtitles", status_code=204)
async def update_native_subtitles(
    session_id: int,
    payload: SessionNativeSubtitlesRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    user = _require_user(request, db)
    session = db.get(AnalysisSession, session_id)
    if session is None or session.user_id != user.id:
        raise HTTPException(status_code=404, detail="Session not found.")
    session.native_subtitles = [s.model_dump() for s in payload.native_subtitles] or None
    db.commit()
    return Response(status_code=204)


@router.delete("/{session_id}", status_code=204)
async def delete_session(session_id: int, request: Request, db: Session = Depends(get_db)):
    user = _require_user(request, db)
    session = db.get(AnalysisSession, session_id)
    if session is None or session.user_id != user.id:
        raise HTTPException(status_code=404, detail="Session not found.")
    db.delete(session)
    db.commit()
    return Response(status_code=204)
