from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.dependencies import get_db, get_current_user
from app.models import User
from app.routers.api_sessions import _get_accessible_session
from app.services.app_settings import effective_max_upload_bytes
from app.services.processor_registry import get_available_languages
from app.templating import templates

router = APIRouter(tags=["pages"])


@router.get("/", response_class=HTMLResponse)
async def index(request: Request, db: Session = Depends(get_db)):
    user = get_current_user(request, db)
    languages = get_available_languages()
    return templates.TemplateResponse(
        request,
        "index.html",
        {
            "user": user,
            "languages": languages,
            "max_upload_bytes": effective_max_upload_bytes(db, user),
            "demo_mode": False,
        },
    )


@router.get("/demo", response_class=HTMLResponse)
async def demo(request: Request, db: Session = Depends(get_db)):
    # The public demo page reuses the full app UI; only the sidebar source and a
    # few controls change, driven by the demo_mode flag (see index.html / app.js).
    user = get_current_user(request, db)
    languages = get_available_languages()
    return templates.TemplateResponse(
        request,
        "index.html",
        {
            "user": user,
            "languages": languages,
            "max_upload_bytes": effective_max_upload_bytes(db, user),
            "demo_mode": True,
        },
    )


@router.get("/about", response_class=HTMLResponse)
async def about(request: Request, db: Session = Depends(get_db)):
    user = get_current_user(request, db)
    return templates.TemplateResponse(
        request,
        "about.html",
        {"user": user},
    )


@router.get("/sessions/{session_id}/cards", response_class=HTMLResponse)
async def create_cards(session_id: int, request: Request, db: Session = Depends(get_db)):
    # Card-creation wizard; its data (session + draft) is loaded by cards.js.
    user = get_current_user(request, db)
    if user is None:
        return RedirectResponse("/login", status_code=303)
    try:
        session, _ = _get_accessible_session(session_id, user, db)
    except HTTPException:
        return RedirectResponse("/", status_code=303)
    return templates.TemplateResponse(
        request,
        "cards.html",
        {"user": user, "session_id": session.id, "session_name": session.name},
    )


@router.get("/study", response_class=HTMLResponse)
async def study(request: Request, db: Session = Depends(get_db)):
    user = get_current_user(request, db)
    if user is None:
        return RedirectResponse("/login", status_code=303)
    return templates.TemplateResponse(request, "study.html", {"user": user})


@router.get("/login", response_class=HTMLResponse)
async def login_page(request: Request, db: Session = Depends(get_db)):
    # In dev mode, surface every existing user so they can be impersonated with
    # one click (see /auth/dev-login). Never populated in production.
    dev_users = (
        db.query(User).order_by(User.email).all() if settings.DEV_MODE else []
    )
    return templates.TemplateResponse(
        request,
        "login.html",
        {"user": None, "dev_mode": settings.DEV_MODE, "dev_users": dev_users},
    )
