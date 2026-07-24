import logging

from typing import Optional

from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, Request, Depends, Form, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.config import settings, admin_emails
from app.database import SessionLocal
from app.models import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

oauth = OAuth()
oauth.register(
    name="google",
    client_id=settings.GOOGLE_CLIENT_ID,
    client_secret=settings.GOOGLE_CLIENT_SECRET,
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={"scope": "openid email profile"},
)


def _get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.get("/google")
async def login_via_google(request: Request):
    redirect_uri = request.url_for("auth_google_callback")
    return await oauth.google.authorize_redirect(request, redirect_uri)


@router.get("/google/callback", name="auth_google_callback")
async def auth_google_callback(request: Request, db: Session = Depends(_get_db)):
    try:
        token = await oauth.google.authorize_access_token(request)
    except Exception as exc:
        logger.error("OAuth callback error: %s", exc)
        return RedirectResponse("/")

    resp = await oauth.google.get(
        "https://www.googleapis.com/oauth2/v3/userinfo", token=token
    )
    user_info = resp.json()
    email = user_info.get("email")
    picture = user_info.get("picture")
    if not email:
        return RedirectResponse("/")

    user = db.query(User).filter(User.email == email).first()
    if user is None:
        user = User(email=email, picture=picture)
        db.add(user)
    else:
        user.picture = picture

    # Bootstrap admins from ADMIN_EMAILS (auto-grant only; never auto-demote).
    if email.lower() in admin_emails():
        user.is_admin = True

    db.commit()
    db.refresh(user)

    request.session["user_id"] = user.id
    return RedirectResponse("/")


@router.post("/dev-login")
async def dev_login(
    request: Request,
    user_id: Optional[int] = Form(None),
    email: Optional[str] = Form(None),
    db: Session = Depends(_get_db),
):
    """Local-development shortcut: log in without a Google round-trip.

    Provide either ``user_id`` to impersonate an existing user, or ``email`` to
    log in by address — creating the user if it does not exist yet. The
    create-if-missing path lets automated tests (e.g. Playwright) spin up fresh,
    isolated accounts on demand.

    Disabled unless DEV_MODE is set, so it can never be hit in production.
    """
    if not settings.DEV_MODE:
        raise HTTPException(status_code=404)

    if user_id is not None:
        user = db.get(User, user_id)
        if user is None:
            raise HTTPException(status_code=404, detail="No such user.")
    elif email:
        email = email.strip()
        user = db.query(User).filter(User.email == email).first()
        if user is None:
            user = User(email=email)
            if email.lower() in admin_emails():
                user.is_admin = True
            db.add(user)
            db.commit()
            db.refresh(user)
    else:
        raise HTTPException(status_code=422, detail="Provide user_id or email.")

    request.session["user_id"] = user.id
    return RedirectResponse("/", status_code=303)


@router.get("/logout")
async def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/")
