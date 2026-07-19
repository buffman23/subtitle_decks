"""Persisting a finished analysis as an AnalysisSession.

Shared by the create-session endpoint and the background analysis worker so a
session is saved identically whether the client asks for it or the worker
auto-saves it on job completion. Keeping this out of the router avoids the worker
(a service) importing a router.
"""
import os
from datetime import datetime

from sqlalchemy.orm import Session

from app.dependencies import resolve_language_id
from app.models import AnalysisSession


def _unique_session_name(db: Session, user_id: int, lang_id: int, base_name: str) -> str:
    """A name unique among the user's sessions in this language: 'foo', 'foo (2)'…"""
    existing = {
        s.name
        for s in db.query(AnalysisSession.name).filter(
            AnalysisSession.user_id == user_id,
            AnalysisSession.language_id == lang_id,
        )
    }
    if base_name not in existing:
        return base_name
    counter = 2
    while f"{base_name} ({counter})" in existing:
        counter += 1
    return f"{base_name} ({counter})"


def persist_analysis_session(
    db: Session,
    *,
    user_id: int,
    language_code: str,
    srt_filename: str,
    subtitles: list,
    results: list,
    native_subtitles: list | None = None,
) -> AnalysisSession:
    """Create and commit an AnalysisSession, returning the persisted row.

    subtitles/results are stored as-is (they are already JSON-native dicts,
    whether they come from the analyzer or from a validated request payload).
    """
    lang_id = resolve_language_id(language_code, db)
    base_name = os.path.splitext(srt_filename)[0]
    session = AnalysisSession(
        user_id=user_id,
        name=_unique_session_name(db, user_id, lang_id, base_name),
        language_id=lang_id,
        srt_filename=srt_filename,
        subtitles=subtitles,
        native_subtitles=native_subtitles or None,
        results=results,
        created_at=datetime.utcnow(),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session
