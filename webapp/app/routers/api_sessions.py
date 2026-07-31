from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.dependencies import get_db, get_current_user, require_admin
from app.models import AnalysisSession, SessionShare, User
from app.services.app_settings import (
    get_default_demo_session_id,
    set_default_demo_session_id,
)
from app.services.session_store import persist_analysis_session
from app.schemas import (
    SessionCreateRequest,
    SessionDetail,
    SessionNativeSubtitlesRequest,
    SessionOut,
    SessionRenameRequest,
    SessionShareCreateRequest,
    ShareRecipient,
)

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


def _require_user(request: Request, db: Session):
    user = get_current_user(request, db)
    if user is None:
        raise HTTPException(status_code=401, detail="Login required.")
    return user


def _get_accessible_session(session_id: int, user: User, db: Session) -> tuple[AnalysisSession, bool]:
    """Return (session, is_owner) if the user owns or has a share for it; else 404."""
    session = db.get(AnalysisSession, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found.")
    if session.user_id == user.id:
        return session, True
    share = (
        db.query(SessionShare)
        .filter(
            SessionShare.session_id == session_id,
            SessionShare.shared_with_user_id == user.id,
        )
        .first()
    )
    if share is None:
        raise HTTPException(status_code=404, detail="Session not found.")
    return session, False


def _require_owned_session(session_id: int, user: User, db: Session) -> AnalysisSession:
    """Load a session the user owns, or 404 (used for owner-only mutations)."""
    session = db.get(AnalysisSession, session_id)
    if session is None or session.user_id != user.id:
        raise HTTPException(status_code=404, detail="Session not found.")
    return session


@router.get("", response_model=list[SessionOut])
async def list_sessions(
    request: Request,
    db: Session = Depends(get_db),
):
    user = _require_user(request, db)
    owned = (
        db.query(AnalysisSession)
        .filter(AnalysisSession.user_id == user.id)
        .order_by(AnalysisSession.created_at.desc())
        .all()
    )
    shared = (
        db.query(AnalysisSession)
        .join(SessionShare, SessionShare.session_id == AnalysisSession.id)
        .filter(SessionShare.shared_with_user_id == user.id)
        .order_by(AnalysisSession.created_at.desc())
        .all()
    )
    out = [
        SessionOut(
            id=s.id, name=s.name, language=s.language,
            srt_filename=s.srt_filename, created_at=s.created_at, owned=True,
        )
        for s in owned
    ]
    out += [
        SessionOut(
            id=s.id, name=s.name, language=s.language,
            srt_filename=s.srt_filename, created_at=s.created_at,
            owned=False, owner_email=s.user.email,
        )
        for s in shared
    ]
    return out


@router.get("/{session_id}", response_model=SessionDetail)
async def get_session(session_id: int, request: Request, db: Session = Depends(get_db)):
    user = _require_user(request, db)
    session, is_owner = _get_accessible_session(session_id, user, db)
    shared_with = (
        [ShareRecipient(user_id=sh.shared_with_user_id, email=sh.shared_with_user.email)
         for sh in session.shares]
        if is_owner else []
    )
    return SessionDetail(
        id=session.id, name=session.name, language=session.language,
        srt_filename=session.srt_filename, subtitles=session.subtitles,
        native_subtitles=session.native_subtitles, results=session.results,
        created_at=session.created_at, owned=is_owner, shared_with=shared_with,
        owner_email=None if is_owner else session.user.email,
        is_demo=session.is_demo,
    )


@router.post("", response_model=SessionOut, status_code=201)
async def create_session(
    payload: SessionCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    user = _require_user(request, db)
    return persist_analysis_session(
        db,
        user_id=user.id,
        language_code=payload.language,
        srt_filename=payload.srt_filename,
        subtitles=[s.model_dump() for s in payload.subtitles],
        native_subtitles=[s.model_dump() for s in payload.native_subtitles],
        results=[r.model_dump() for r in payload.results],
    )


@router.patch("/{session_id}", response_model=SessionOut)
async def rename_session(
    session_id: int,
    payload: SessionRenameRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    user = _require_user(request, db)
    session = _require_owned_session(session_id, user, db)
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
    session = _require_owned_session(session_id, user, db)
    session.native_subtitles = [s.model_dump() for s in payload.native_subtitles] or None
    db.commit()
    return Response(status_code=204)


@router.delete("/{session_id}", status_code=204)
async def delete_session(session_id: int, request: Request, db: Session = Depends(get_db)):
    user = _require_user(request, db)
    session, is_owner = _get_accessible_session(session_id, user, db)
    if is_owner:
        # Owner delete removes the session entirely (cascade clears its shares).
        db.delete(session)
    else:
        # Recipient delete only revokes their own access (self-unshare).
        db.query(SessionShare).filter(
            SessionShare.session_id == session_id,
            SessionShare.shared_with_user_id == user.id,
        ).delete()
    db.commit()
    return Response(status_code=204)


@router.get("/{session_id}/shares", response_model=list[ShareRecipient])
async def list_shares(session_id: int, request: Request, db: Session = Depends(get_db)):
    user = _require_user(request, db)
    session = _require_owned_session(session_id, user, db)
    return [
        ShareRecipient(user_id=sh.shared_with_user_id, email=sh.shared_with_user.email)
        for sh in session.shares
    ]


@router.post("/{session_id}/shares", response_model=list[ShareRecipient], status_code=201)
async def share_session(
    session_id: int,
    payload: SessionShareCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    user = _require_user(request, db)
    session = _require_owned_session(session_id, user, db)
    email = payload.email.strip()
    recipient = db.query(User).filter(func.lower(User.email) == email.lower()).first()
    if recipient is None:
        raise HTTPException(status_code=404, detail="No account exists for that email.")
    if recipient.id == user.id:
        raise HTTPException(status_code=400, detail="You can't share a session with yourself.")
    existing = (
        db.query(SessionShare)
        .filter(
            SessionShare.session_id == session_id,
            SessionShare.shared_with_user_id == recipient.id,
        )
        .first()
    )
    if existing is not None:
        raise HTTPException(status_code=400, detail=f"Already shared with {recipient.email}.")
    db.add(SessionShare(session_id=session_id, shared_with_user_id=recipient.id))
    db.commit()
    db.refresh(session)
    return [
        ShareRecipient(user_id=sh.shared_with_user_id, email=sh.shared_with_user.email)
        for sh in session.shares
    ]


@router.delete("/{session_id}/shares/{user_id}", status_code=204)
async def unshare_session(
    session_id: int, user_id: int, request: Request, db: Session = Depends(get_db)
):
    user = _require_user(request, db)
    _require_owned_session(session_id, user, db)
    db.query(SessionShare).filter(
        SessionShare.session_id == session_id,
        SessionShare.shared_with_user_id == user_id,
    ).delete()
    db.commit()
    return Response(status_code=204)


# --- Demo page management (admin-only) -------------------------------------
# Admins flag any session as a demo (from the owner's Share dropdown) and remove
# it again (from the public /demo page). No ownership requirement, so a single
# pair of endpoints serves both entry points.

def _set_demo(session_id: int, is_demo: bool, db: Session) -> Response:
    session = db.get(AnalysisSession, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found.")
    session.is_demo = is_demo
    # Removing a session from the demo page must not leave it pinned as the default.
    if not is_demo and get_default_demo_session_id(db) == session_id:
        set_default_demo_session_id(db, None)
    db.commit()
    return Response(status_code=204)


@router.post("/{session_id}/demo", status_code=204)
async def add_to_demo(
    session_id: int, db: Session = Depends(get_db), _admin: User = Depends(require_admin)
):
    return _set_demo(session_id, True, db)


@router.delete("/{session_id}/demo", status_code=204)
async def remove_from_demo(
    session_id: int, db: Session = Depends(get_db), _admin: User = Depends(require_admin)
):
    return _set_demo(session_id, False, db)


@router.post("/{session_id}/demo/default", status_code=204)
async def set_demo_default(
    session_id: int, db: Session = Depends(get_db), _admin: User = Depends(require_admin)
):
    """Pin a demo session as the one the /demo page auto-opens. Admin-only."""
    session = db.get(AnalysisSession, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found.")
    if not session.is_demo:
        raise HTTPException(status_code=400, detail="Only a demo session can be the default.")
    set_default_demo_session_id(db, session_id)
    return Response(status_code=204)
