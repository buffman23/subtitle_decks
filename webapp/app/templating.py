"""Shared Jinja2 templates instance + globals (used by all routers)."""
import os
import time
from datetime import datetime

from fastapi.templating import Jinja2Templates

from app.database import SessionLocal
from app.services.app_settings import get_github_url
from app.version import get_build_info

templates = Jinja2Templates(directory="app/templates")


def asset_url(path: str) -> str:
    """Static asset URL with an mtime cache-buster so browsers refetch on change."""
    rel = path.lstrip("/")
    try:
        version = int(os.path.getmtime(os.path.join("app/static", rel)))
    except OSError:
        version = int(time.time())
    return f"/static/{rel}?v={version}"


def humanize_age(dt: datetime | None) -> str:
    """Render a coarse relative age, e.g. 'today', '5 days', '3 months', '2 years'."""
    if dt is None:
        return "unknown"
    days = (datetime.utcnow() - dt).days
    if days < 1:
        return "today"
    if days < 60:
        return f"{days} day{'s' if days != 1 else ''}"
    if days < 730:
        months = days // 30
        return f"{months} month{'s' if months != 1 else ''}"
    years = days // 365
    return f"{years} year{'s' if years != 1 else ''}"


def humanize_bytes(num: int | None) -> str:
    """Render a byte count in human units, e.g. '0 B', '4.2 KB', '1.3 MB'."""
    size = float(num or 0)
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            precision = 0 if unit == "B" else 1
            return f"{size:.{precision}f} {unit}"
        size /= 1024


templates.env.globals["asset_url"] = asset_url
templates.env.globals["humanize_age"] = humanize_age
templates.env.globals["humanize_bytes"] = humanize_bytes
templates.env.globals["build_info"] = get_build_info()
def current_github_url() -> str:
    """Navbar GitHub link, read per render so an admin change shows at once
    (and stays consistent across worker processes)."""
    db = SessionLocal()
    try:
        return get_github_url(db)
    finally:
        db.close()


templates.env.globals["github_url"] = current_github_url
