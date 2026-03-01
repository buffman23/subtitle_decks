from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from app.config import settings
from app.database import create_db_tables
from app.services.arabic_processor import preload_all as preload_arabic
from app.auth import router as auth_router
from app.routers.pages import router as pages_router
from app.routers.api_analysis import router as analysis_router
from app.routers.api_ignorelist import router as ignorelist_router
from app.routers.api_sessions import router as sessions_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_tables()
    preload_arabic()
    yield


app = FastAPI(title="Arabic Subtitle Frequency Analyzer", lifespan=lifespan)

app.add_middleware(SessionMiddleware, secret_key=settings.SECRET_KEY)

app.mount("/static", StaticFiles(directory="app/static"), name="static")

app.include_router(pages_router)
app.include_router(auth_router)
app.include_router(analysis_router)
app.include_router(ignorelist_router)
app.include_router(sessions_router)
