from typing import Generator

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import LanguageRow, User


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(request: Request, db: Session = None) -> User | None:
    """
    Read user_id from the server-side session cookie and return the User ORM object.
    Returns None if not authenticated.
    Call via FastAPI dependency injection with get_db already resolved.
    """
    user_id = request.session.get("user_id")
    if not user_id or db is None:
        return None
    return db.get(User, user_id)


def require_admin(request: Request, db: Session = Depends(get_db)) -> User:
    """Dependency for admin-only JSON endpoints: 403 unless the user is an admin."""
    user = get_current_user(request, db)
    if user is None or not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required.")
    return user


def resolve_language_id(code: str, db: Session) -> int:
    """Look up a language by code and return its DB id, or raise HTTP 422."""
    lang = db.query(LanguageRow).filter(LanguageRow.code == code).first()
    if lang is None:
        raise HTTPException(status_code=422, detail=f"Unknown language: {code!r}")
    return lang.id
