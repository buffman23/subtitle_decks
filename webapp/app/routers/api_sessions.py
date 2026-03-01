from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.dependencies import get_db, get_current_user
from app.models import AnalysisSession
from app.schemas import SessionCreateRequest, SessionDetail, SessionOut, SessionRenameRequest

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


def _require_user(request: Request, db: Session):
    user = get_current_user(request, db)
    if user is None:
        raise HTTPException(status_code=401, detail="Login required.")
    return user


@router.get("", response_model=list[SessionOut])
async def list_sessions(request: Request, db: Session = Depends(get_db)):
    user = _require_user(request, db)
    sessions = (
        db.query(AnalysisSession)
        .filter(AnalysisSession.user_id == user.id)
        .order_by(AnalysisSession.created_at.desc())
        .all()
    )
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
    name = payload.name or f"Session {datetime.utcnow().strftime('%Y-%m-%d %H:%M')}"
    session = AnalysisSession(
        user_id=user.id,
        name=name,
        language=payload.language,
        srt_filename=payload.srt_filename,
        srt_content=payload.srt_content,
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
    session.name = payload.name.strip() or session.name
    db.commit()
    db.refresh(session)
    return session


@router.delete("/{session_id}", status_code=204)
async def delete_session(session_id: int, request: Request, db: Session = Depends(get_db)):
    user = _require_user(request, db)
    session = db.get(AnalysisSession, session_id)
    if session is None or session.user_id != user.id:
        raise HTTPException(status_code=404, detail="Session not found.")
    db.delete(session)
    db.commit()
    return Response(status_code=204)
