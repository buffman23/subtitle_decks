from typing import Generator

from fastapi import Request
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import User


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
