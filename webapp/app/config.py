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
    # AnkiConnect endpoint for the server-side Anki instance that holds every
    # user's decks (each user's decks live under a top-level deck named after
    # their email). Must never be publicly reachable.
    ANKICONNECT_URL: str = "http://127.0.0.1:8765"
    ANKICONNECT_KEY: str = ""
    # .apkg export hand-off: Anki writes the package into ANKI_EXPORT_DIR_ANKI
    # (the path as the Anki process sees it) and the app reads it back from
    # ANKI_EXPORT_DIR_APP (the same directory/volume as this process sees it).
    # Both default to one local directory for single-host development.
    ANKI_EXPORT_DIR_ANKI: str = ""
    ANKI_EXPORT_DIR_APP: str = ""
    # Image/audio uploaded during card creation, held until the deck is submitted.
    CARD_MEDIA_DIR: str = "data/card_media"

    class Config:
        env_file = ".env"


settings = Settings()


def admin_emails() -> set[str]:
    """Parsed, lowercased set of bootstrap admin emails from ADMIN_EMAILS."""
    return {e.strip().lower() for e in settings.ADMIN_EMAILS.split(",") if e.strip()}
