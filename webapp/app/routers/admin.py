from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.dependencies import get_db, get_current_user
from app.models import AnalysisSession, User
from app.services.processor_registry import get_available_languages, get_processor
from app.templating import templates

router = APIRouter(prefix="/admin", tags=["admin"])


def _admin_or_redirect(request: Request, db: Session):
    """Return the admin user, or a RedirectResponse to '/' for non-admins."""
    user = get_current_user(request, db)
    if user is None or not user.is_admin:
        return None
    return user


@router.get("", response_class=HTMLResponse)
async def admin_index(request: Request, db: Session = Depends(get_db)):
    user = _admin_or_redirect(request, db)
    if user is None:
        return RedirectResponse("/")
    return templates.TemplateResponse(request, "admin/index.html", {"user": user, "active": "index"})


@router.get("/accounts", response_class=HTMLResponse)
async def admin_accounts(request: Request, db: Session = Depends(get_db)):
    user = _admin_or_redirect(request, db)
    if user is None:
        return RedirectResponse("/")

    users = db.query(User).order_by(User.created_at.is_(None), User.created_at.asc()).all()
    counts = dict(
        db.query(AnalysisSession.user_id, func.count())
        .group_by(AnalysisSession.user_id)
        .all()
    )
    accounts = [{"user": u, "session_count": counts.get(u.id, 0)} for u in users]
    return templates.TemplateResponse(
        request,
        "admin/accounts.html",
        {"user": user, "active": "accounts", "accounts": accounts},
    )


@router.get("/models", response_class=HTMLResponse)
async def admin_models(request: Request, db: Session = Depends(get_db)):
    user = _admin_or_redirect(request, db)
    if user is None:
        return RedirectResponse("/")

    models = [
        {
            "code": lang["code"],
            "name": lang["name"],
            "status": "loaded" if get_processor(lang["code"]).is_loaded() else "unloaded",
        }
        for lang in get_available_languages()
    ]
    return templates.TemplateResponse(
        request,
        "admin/models.html",
        {"user": user, "active": "models", "models": models},
    )
