"""DB-backed general application settings (key/value).

Values are persisted as strings in the ``app_settings`` table; the typed
accessors here coerce them and fall back to the registered default whenever a
key is missing or unparseable. Add new general settings by giving them a
default below and a typed accessor pair.
"""
from sqlalchemy.orm import Session

from app.models import AppSetting, User

# Default upload cap: 200 KB.
DEFAULT_MAX_UPLOAD_BYTES = 200 * 1024

_DEFAULTS: dict[str, str] = {
    "max_upload_bytes": str(DEFAULT_MAX_UPLOAD_BYTES),
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


def get_max_upload_bytes(db: Session) -> int:
    """Maximum allowed size of an uploaded subtitle file, in bytes."""
    try:
        value = int(_get_raw(db, "max_upload_bytes"))
    except (TypeError, ValueError):
        return DEFAULT_MAX_UPLOAD_BYTES
    return value if value > 0 else DEFAULT_MAX_UPLOAD_BYTES


def set_max_upload_bytes(db: Session, value: int) -> None:
    _set_raw(db, "max_upload_bytes", str(int(value)))


def effective_max_upload_bytes(db: Session, user: User | None) -> int:
    """Upload cap that applies to ``user``: their per-user override if set,
    otherwise the global default. Guests (``None``) get the global default."""
    if user is not None and user.max_upload_bytes:
        return user.max_upload_bytes
    return get_max_upload_bytes(db)
