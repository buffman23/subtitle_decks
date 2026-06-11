from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from app.config import settings
from app.database import create_db_tables, engine
from app.migrations import run as run_migrations
from app.auth import router as auth_router
from app.routers.pages import router as pages_router
from app.routers.api_analysis import router as analysis_router
from app.routers.api_ignorelist import router as ignorelist_router
from app.routers.api_sessions import router as sessions_router
from app.routers.admin import router as admin_router
from app.routers.api_admin import router as admin_api_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_tables()
    run_migrations(engine)
    yield


app = FastAPI(title="Arabic Subtitle Frequency Analyzer", lifespan=lifespan)

app.add_middleware(
    SessionMiddleware,
    secret_key=settings.SECRET_KEY,
    https_only=settings.SESSION_COOKIE_SECURE,
    same_site="lax",
)

app.mount("/static", StaticFiles(directory="app/static"), name="static")


@app.get("/healthz", include_in_schema=False)
def healthz():
    """Unauthenticated liveness probe for load balancers / App Runner."""
    return {"status": "ok"}

app.include_router(pages_router)
app.include_router(auth_router)
app.include_router(analysis_router)
app.include_router(ignorelist_router)
app.include_router(sessions_router)
app.include_router(admin_router)
app.include_router(admin_api_router)
