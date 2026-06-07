from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    SECRET_KEY: str = "change-me"
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    DATABASE_URL: str = "sqlite:///./app.db"
    ADMIN_EMAILS: str = ""

    class Config:
        env_file = ".env"


settings = Settings()


def admin_emails() -> set[str]:
    """Parsed, lowercased set of bootstrap admin emails from ADMIN_EMAILS."""
    return {e.strip().lower() for e in settings.ADMIN_EMAILS.split(",") if e.strip()}
