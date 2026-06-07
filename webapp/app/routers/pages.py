import os
import time

from fastapi import APIRouter, Request, Depends
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.dependencies import get_db, get_current_user
from app.services.processor_registry import get_available_languages

router = APIRouter(tags=["pages"])
templates = Jinja2Templates(directory="app/templates")


def asset_url(path: str) -> str:
    """Static asset URL with an mtime cache-buster so browsers refetch on change."""
    rel = path.lstrip("/")
    try:
        version = int(os.path.getmtime(os.path.join("app/static", rel)))
    except OSError:
        version = int(time.time())
    return f"/static/{rel}?v={version}"


templates.env.globals["asset_url"] = asset_url


@router.get("/", response_class=HTMLResponse)
async def index(request: Request, db: Session = Depends(get_db)):
    user = get_current_user(request, db)
    languages = get_available_languages()
    return templates.TemplateResponse(
        request,
        "index.html",
        {"user": user, "languages": languages},
    )


@router.get("/about", response_class=HTMLResponse)
async def about(request: Request, db: Session = Depends(get_db)):
    user = get_current_user(request, db)
    return templates.TemplateResponse(
        request,
        "about.html",
        {"user": user},
    )


@router.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    return templates.TemplateResponse(
        request,
        "login.html",
        {"user": None},
    )
