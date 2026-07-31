"""
Schema migrations — safe to run on every startup.
Each step is idempotent: it checks current state before acting.
"""
from sqlalchemy import text
from sqlalchemy.engine import Engine


def run(engine: Engine) -> None:
    with engine.begin() as conn:
        _seed_languages(conn)
        _migrate_ignore_list_language(conn)
        _migrate_sessions_language(conn)
        _migrate_sessions_subtitles(conn)
        _migrate_sessions_native_subtitles(conn)
        _migrate_sessions_is_demo(conn)
        _migrate_users_picture(conn)
        _migrate_users_is_admin(conn)
        _migrate_users_created_at(conn)
        _migrate_users_max_upload_bytes(conn)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _table_columns(conn, table: str) -> set[str]:
    rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
    return {row[1] for row in rows}


def _seed_languages(conn) -> None:
    """Insert language rows from the processor registry (no processor instantiation)."""
    from app.services.processor_registry import _REGISTRY
    for i, (code, info) in enumerate(_REGISTRY.items(), start=1):
        conn.execute(
            text("INSERT OR IGNORE INTO languages (id, code, name) VALUES (:id, :code, :name)"),
            {"id": i, "code": code, "name": info["name"]},
        )


def _migrate_ignore_list_language(conn) -> None:
    """Rename ignore_list_entries.language -> language_id (already stores int values)."""
    cols = _table_columns(conn, "ignore_list_entries")
    if "language" in cols and "language_id" not in cols:
        conn.execute(text("ALTER TABLE ignore_list_entries RENAME COLUMN language TO language_id"))


def _migrate_sessions_language(conn) -> None:
    """Convert analysis_sessions.language (string code) -> language_id (int FK)."""
    cols = _table_columns(conn, "analysis_sessions")
    if "language_id" in cols:
        return  # already migrated

    # Recreate the table with language_id instead of language (string).
    # SQLite does not support ALTER COLUMN, so we use the standard rename-recreate approach.
    conn.execute(text("""
        CREATE TABLE analysis_sessions_new (
            id          INTEGER PRIMARY KEY,
            user_id     INTEGER REFERENCES users(id),
            name        VARCHAR NOT NULL,
            language_id INTEGER REFERENCES languages(id),
            srt_filename VARCHAR NOT NULL,
            srt_content TEXT NOT NULL,
            results     JSON NOT NULL,
            created_at  DATETIME
        )
    """))
    conn.execute(text("""
        INSERT INTO analysis_sessions_new
            (id, user_id, name, language_id, srt_filename, srt_content, results, created_at)
        SELECT
            s.id, s.user_id, s.name,
            (SELECT l.id FROM languages l WHERE l.code = s.language),
            s.srt_filename, s.srt_content, s.results, s.created_at
        FROM analysis_sessions s
    """))
    conn.execute(text("DROP TABLE analysis_sessions"))
    conn.execute(text("ALTER TABLE analysis_sessions_new RENAME TO analysis_sessions"))


def _migrate_sessions_subtitles(conn) -> None:
    """Replace analysis_sessions.srt_content (TEXT) with subtitles (JSON NULL)."""
    cols = _table_columns(conn, "analysis_sessions")
    if "srt_content" not in cols:
        return  # already migrated

    conn.execute(text("""
        CREATE TABLE analysis_sessions_new (
            id          INTEGER PRIMARY KEY,
            user_id     INTEGER REFERENCES users(id),
            name        VARCHAR NOT NULL,
            language_id INTEGER REFERENCES languages(id),
            srt_filename VARCHAR NOT NULL,
            subtitles   JSON,
            results     JSON NOT NULL,
            created_at  DATETIME
        )
    """))
    conn.execute(text("""
        INSERT INTO analysis_sessions_new
            (id, user_id, name, language_id, srt_filename, subtitles, results, created_at)
        SELECT
            id, user_id, name, language_id, srt_filename, NULL, results, created_at
        FROM analysis_sessions
    """))
    conn.execute(text("DROP TABLE analysis_sessions"))
    conn.execute(text("ALTER TABLE analysis_sessions_new RENAME TO analysis_sessions"))


def _migrate_sessions_native_subtitles(conn) -> None:
    """Add native_subtitles JSON column to analysis_sessions."""
    cols = _table_columns(conn, "analysis_sessions")
    if "native_subtitles" not in cols:
        conn.execute(text("ALTER TABLE analysis_sessions ADD COLUMN native_subtitles JSON"))


def _migrate_sessions_is_demo(conn) -> None:
    """Add is_demo column to analysis_sessions (featured on the public /demo page)."""
    if "is_demo" not in _table_columns(conn, "analysis_sessions"):
        conn.execute(text("ALTER TABLE analysis_sessions ADD COLUMN is_demo BOOLEAN NOT NULL DEFAULT 0"))


def _migrate_users_picture(conn) -> None:
    """Add picture column to users."""
    cols = _table_columns(conn, "users")
    if "picture" not in cols:
        conn.execute(text("ALTER TABLE users ADD COLUMN picture VARCHAR"))


def _migrate_users_is_admin(conn) -> None:
    """Add is_admin column to users."""
    if "is_admin" not in _table_columns(conn, "users"):
        conn.execute(text("ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT 0"))


def _migrate_users_created_at(conn) -> None:
    """Add created_at column to users (NULL for pre-existing rows)."""
    if "created_at" not in _table_columns(conn, "users"):
        conn.execute(text("ALTER TABLE users ADD COLUMN created_at DATETIME"))


def _migrate_users_max_upload_bytes(conn) -> None:
    """Add per-user max_upload_bytes column to users (NULL = use global default)."""
    if "max_upload_bytes" not in _table_columns(conn, "users"):
        conn.execute(text("ALTER TABLE users ADD COLUMN max_upload_bytes INTEGER"))
