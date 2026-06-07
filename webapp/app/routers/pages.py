from fastapi import APIRouter, Request, Depends
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.dependencies import get_db, get_current_user
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
