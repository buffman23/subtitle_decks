from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    SECRET_KEY: str = "change-me"
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    DATABASE_URL: str = "sqlite:///./app.db"
    ADMIN_EMAILS: str = ""
    # Public URL of the source repository. When set, a GitHub icon link appears
    # in the navbar; leave blank to hide it.
    GITHUB_URL: str = ""
    # Set True in production (behind HTTPS) so the session cookie is only sent
    # over TLS. Leave False for local http:// development.
    SESSION_COOKIE_SECURE: bool = False
    # Local development only: enables a "log in as any existing user" picker on
    # the login page (no Google OAuth round-trip). MUST stay False in production.
    DEV_MODE: bool = False

    class Config:
        env_file = ".env"


settings = Settings()


def admin_emails() -> set[str]:
    """Parsed, lowercased set of bootstrap admin emails from ADMIN_EMAILS."""
    return {e.strip().lower() for e in settings.ADMIN_EMAILS.split(",") if e.strip()}
