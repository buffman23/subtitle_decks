"""DB-backed general application settings (key/value).

Values are persisted as strings in the ``app_settings`` table; the typed
accessors here coerce them and fall back to the registered default whenever a
key is missing or unparseable. Add new general settings by giving them a
default below and a typed accessor pair.
"""
from sqlalchemy.orm import Session

from app.config import settings
from app.models import AnalysisSession, AppSetting, User

# Default upload cap: 200 KB.
DEFAULT_MAX_UPLOAD_BYTES = 200 * 1024

_DEFAULTS: dict[str, str] = {
    "max_upload_bytes": str(DEFAULT_MAX_UPLOAD_BYTES),
    # GITHUB_URL from the environment seeds the navbar link until an admin
    # saves one; a saved empty string then hides the link.
    "github_url": settings.GITHUB_URL,
}


def _get_raw(db: Session, key: str) -> str:
    row = db.get(AppSetting, key)
    if row is not None:
        return row.value
    return _DEFAULTS.get(key, "")


def _set_raw(db: Session, key: str, value: str) -> None:
    row = db.get(AppSetting, key)
    if row is None:
        db.add(AppSetting(key=key, value=value))
    else:
        row.value = value
    db.commit()


def _delete_raw(db: Session, key: str) -> None:
    row = db.get(AppSetting, key)
    if row is not None:
        db.delete(row)
        db.commit()


def get_max_upload_bytes(db: Session) -> int:
    """Maximum allowed size of an uploaded subtitle file, in bytes."""
    try:
        value = int(_get_raw(db, "max_upload_bytes"))
    except (TypeError, ValueError):
        return DEFAULT_MAX_UPLOAD_BYTES
    return value if value > 0 else DEFAULT_MAX_UPLOAD_BYTES


def set_max_upload_bytes(db: Session, value: int) -> None:
    _set_raw(db, "max_upload_bytes", str(int(value)))


def get_github_url(db: Session) -> str:
    """Navbar GitHub link; empty means the link is hidden."""
    return _get_raw(db, "github_url").strip()


def set_github_url(db: Session, url: str) -> None:
    _set_raw(db, "github_url", url.strip())


def effective_max_upload_bytes(db: Session, user: User | None) -> int:
    """Upload cap that applies to ``user``: their per-user override if set,
    otherwise the global default. Guests (``None``) get the global default."""
    if user is not None and user.max_upload_bytes:
        return user.max_upload_bytes
    return get_max_upload_bytes(db)


_DEMO_DEFAULT_KEY = "default_demo_session_id"


def get_default_demo_session_id(db: Session) -> int | None:
    """The session id an admin pinned as the demo page default, or None."""
    raw = _get_raw(db, _DEMO_DEFAULT_KEY)
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def set_default_demo_session_id(db: Session, session_id: int | None) -> None:
    """Pin (or, with None, clear) the demo page's default session."""
    if session_id is None:
        _delete_raw(db, _DEMO_DEFAULT_KEY)
    else:
        _set_raw(db, _DEMO_DEFAULT_KEY, str(int(session_id)))


def resolve_default_demo_session(db: Session) -> AnalysisSession | None:
    """The pinned default, but only if it still exists and is still a demo.

    Returns None for an unset, deleted, or un-flagged default so a stale pointer
    never breaks the demo page (callers fall back to the first demo session).
    """
    session_id = get_default_demo_session_id(db)
    if session_id is None:
        return None
    session = db.get(AnalysisSession, session_id)
    if session is None or not session.is_demo:
        return None
    return session
