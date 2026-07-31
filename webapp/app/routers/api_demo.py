from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.dependencies import get_db
from app.models import AnalysisSession
from app.schemas import SessionDetail, SessionOut
from app.services.app_settings import resolve_default_demo_session

# Public, unauthenticated read access to the sessions an admin has flagged as
# demos. Everything here is view-only; mutations (flagging / unflagging) live in
# the admin-only routes on api_sessions.py.
router = APIRouter(prefix="/api/demo", tags=["demo"])


@router.get("/sessions", response_model=list[SessionOut])
async def list_demo_sessions(db: Session = Depends(get_db)):
    sessions = (
        db.query(AnalysisSession)
        .filter(AnalysisSession.is_demo.is_(True))
        .order_by(AnalysisSession.created_at.desc())
        .all()
    )
    default = resolve_default_demo_session(db)
    default_id = default.id if default is not None else None
    return [
        SessionOut(
            id=s.id, name=s.name, language=s.language,
            srt_filename=s.srt_filename, created_at=s.created_at,
            owned=False, is_demo=True, is_default=(s.id == default_id),
        )
        for s in sessions
    ]


@router.get("/sessions/{session_id}", response_model=SessionDetail)
async def get_demo_session(session_id: int, db: Session = Depends(get_db)):
    session = db.get(AnalysisSession, session_id)
    if session is None or not session.is_demo:
        raise HTTPException(status_code=404, detail="Session not found.")
    return SessionDetail(
        id=session.id, name=session.name, language=session.language,
        srt_filename=session.srt_filename, subtitles=session.subtitles,
        native_subtitles=session.native_subtitles, results=session.results,
        created_at=session.created_at, owned=False, shared_with=[],
        owner_email=None, is_demo=True,
    )
