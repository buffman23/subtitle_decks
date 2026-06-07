"""Shared Jinja2 templates instance + globals (used by all routers)."""
import os
import time
from datetime import datetime

from fastapi.templating import Jinja2Templates

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


templates.env.globals["asset_url"] = asset_url
templates.env.globals["humanize_age"] = humanize_age
