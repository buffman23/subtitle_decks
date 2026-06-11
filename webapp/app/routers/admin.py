from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.dependencies import get_db, get_current_user
from app.models import AnalysisSession, LanguageRow, User
from app.services.app_settings import get_max_upload_bytes
from app.services.processor_registry import get_available_languages, get_processor
from app.services.system_stats import get_system_stats
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
    # Approximate storage as the serialized length of each session's JSON blobs.
    storage = dict(
        db.query(
            AnalysisSession.user_id,
            func.sum(
                func.coalesce(func.length(AnalysisSession.subtitles), 0)
                + func.coalesce(func.length(AnalysisSession.native_subtitles), 0)
                + func.coalesce(func.length(AnalysisSession.results), 0)
            ),
        )
        .group_by(AnalysisSession.user_id)
        .all()
    )
    accounts = [
        {
            "user": u,
            "session_count": counts.get(u.id, 0),
            "storage_bytes": storage.get(u.id, 0) or 0,
        }
        for u in users
    ]
    return templates.TemplateResponse(
        request,
        "admin/accounts.html",
        {
            "user": user,
            "active": "accounts",
            "accounts": accounts,
            "default_upload_kb": get_max_upload_bytes(db) // 1024,
        },
    )


@router.get("/models", response_class=HTMLResponse)
async def admin_models(request: Request, db: Session = Depends(get_db)):
    user = _admin_or_redirect(request, db)
    if user is None:
        return RedirectResponse("/")

    models = []
    for lang in get_available_languages():
        processor = get_processor(lang["code"])
        loaded = processor.is_loaded()
        models.append(
            {
                "code": lang["code"],
                "name": lang["name"],
                "status": "loaded" if loaded else "unloaded",
                "ram_bytes": processor.ram_bytes(),
                "auto_unload": processor.auto_unload,
            }
        )
    return templates.TemplateResponse(
        request,
        "admin/models.html",
        {"user": user, "active": "models", "models": models},
    )


@router.get("/queue", response_class=HTMLResponse)
async def admin_queue(request: Request, db: Session = Depends(get_db)):
    user = _admin_or_redirect(request, db)
    if user is None:
        return RedirectResponse("/")
    return templates.TemplateResponse(request, "admin/queue.html", {"user": user, "active": "queue"})


@router.get("/settings", response_class=HTMLResponse)
async def admin_settings(request: Request, db: Session = Depends(get_db)):
    user = _admin_or_redirect(request, db)
    if user is None:
        return RedirectResponse("/")
    return templates.TemplateResponse(
        request,
        "admin/settings.html",
        {
            "user": user,
            "active": "settings",
            "max_upload_kb": get_max_upload_bytes(db) // 1024,
        },
    )


@router.get("/system", response_class=HTMLResponse)
def admin_system(request: Request, db: Session = Depends(get_db)):
    # Sync route: the CPU sample and directory walk block briefly, so let
    # FastAPI run this in its threadpool instead of the event loop.
    user = _admin_or_redirect(request, db)
    if user is None:
        return RedirectResponse("/")

    return templates.TemplateResponse(
        request,
        "admin/system.html",
        {"user": user, "active": "system", "stats": get_system_stats()},
    )


@router.get("/metrics", response_class=HTMLResponse)
async def admin_metrics(request: Request, db: Session = Depends(get_db)):
    user = _admin_or_redirect(request, db)
    if user is None:
        return RedirectResponse("/")

    now = datetime.utcnow()
    cutoff_7 = now - timedelta(days=7)
    cutoff_30 = now - timedelta(days=30)

    total_users = db.query(func.count(User.id)).scalar() or 0
    total_analyses = db.query(func.count(AnalysisSession.id)).scalar() or 0
    active_7 = (
        db.query(func.count(func.distinct(AnalysisSession.user_id)))
        .filter(AnalysisSession.created_at >= cutoff_7)
        .scalar()
        or 0
    )
    active_30 = (
        db.query(func.count(func.distinct(AnalysisSession.user_id)))
        .filter(AnalysisSession.created_at >= cutoff_30)
        .scalar()
        or 0
    )
    metrics = {
        "total_users": total_users,
        "total_analyses": total_analyses,
        "active_7": active_7,
        "active_30": active_30,
    }

    # Per-day series for the last 30 days (zero-filled so gaps render as 0).
    day_keys = [(now - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(29, -1, -1)]

    def _per_day(ts_column) -> dict[str, int]:
        rows = (
            db.query(func.date(ts_column), func.count())
            .filter(ts_column >= cutoff_30)
            .group_by(func.date(ts_column))
            .all()
        )
        return {str(day): count for day, count in rows if day is not None}

    analyses_by_day = _per_day(AnalysisSession.created_at)
    signups_by_day = _per_day(User.created_at)

    # Per-language analysis counts.
    lang_rows = (
        db.query(LanguageRow.code, func.count(AnalysisSession.id))
        .join(AnalysisSession, AnalysisSession.language_id == LanguageRow.id)
        .group_by(LanguageRow.code)
        .order_by(func.count(AnalysisSession.id).desc())
        .all()
    )

    # Top users by analysis count.
    top_users = (
        db.query(User.email, func.count(AnalysisSession.id).label("cnt"))
        .join(AnalysisSession, AnalysisSession.user_id == User.id)
        .group_by(User.id)
        .order_by(func.count(AnalysisSession.id).desc())
        .limit(10)
        .all()
    )

    chart_data = {
        "activity": {
            "labels": day_keys,
            "analyses": [analyses_by_day.get(d, 0) for d in day_keys],
            "signups": [signups_by_day.get(d, 0) for d in day_keys],
        },
        "languages": {
            "labels": [code for code, _ in lang_rows],
            "counts": [count for _, count in lang_rows],
        },
    }

    return templates.TemplateResponse(
        request,
        "admin/metrics.html",
        {
            "user": user,
            "active": "metrics",
            "metrics": metrics,
            "chart_data": chart_data,
            "top_users": [{"email": email, "count": count} for email, count in top_users],
        },
    )
