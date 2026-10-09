from datetime import datetime
from sqlalchemy import Integer, String, DateTime, ForeignKey, UniqueConstraint, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.database import Base


class LanguageRow(Base):
    __tablename__ = "languages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String, unique=True)
    name: Mapped[str] = mapped_column(String)


class AppSetting(Base):
    """Key/value store for general, admin-configurable application settings.

    Values are stored as strings; typed accessors live in
    app.services.app_settings.
    """
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str] = mapped_column(String, nullable=False)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True, index=True)
    picture: Mapped[str | None] = mapped_column(String, nullable=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="0")
    # Per-user upload size cap in bytes; NULL means "use the global default".
    max_upload_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=datetime.utcnow, nullable=True)

    ignore_list_entries: Mapped[list["IgnoreListEntry"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    sessions: Mapped[list["AnalysisSession"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    # Shares this user has *received* (sessions shared with them by others).
    received_shares: Mapped[list["SessionShare"]] = relationship(
        foreign_keys="SessionShare.shared_with_user_id",
        back_populates="shared_with_user",
        cascade="all, delete-orphan",
    )


class IgnoreListEntry(Base):
    __tablename__ = "ignore_list_entries"
    __table_args__ = (UniqueConstraint("user_id", "word", "language_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"))
    word: Mapped[str] = mapped_column(String)
    language_id: Mapped[int] = mapped_column(Integer, ForeignKey("languages.id"))

    user: Mapped["User"] = relationship(back_populates="ignore_list_entries")
    language_row: Mapped["LanguageRow"] = relationship()

    @property
    def language(self) -> str:
        return self.language_row.code


class AnalysisSession(Base):
    __tablename__ = "analysis_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String)
    language_id: Mapped[int] = mapped_column(Integer, ForeignKey("languages.id"))
    srt_filename: Mapped[str] = mapped_column(String)
    subtitles: Mapped[list | None] = mapped_column(JSON, nullable=True)
    native_subtitles: Mapped[list | None] = mapped_column(JSON, nullable=True)
    results: Mapped[list] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    # When True, the session is featured on the public /demo page (admin-managed).
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="0")

    user: Mapped["User"] = relationship(back_populates="sessions")
    language_row: Mapped["LanguageRow"] = relationship()
    # Recipients this session has been shared with. Deleting the session (by its
    # owner) cascades these away so no orphaned share rows remain.
    shares: Mapped[list["SessionShare"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )

    @property
    def language(self) -> str:
        return self.language_row.code


class DefinitionCache(Base):
    """Cached Wiktionary definitions for one lemma (see services/dictionary.py).

    `entries` is [{pos, definitions: [str]}]; an empty list caches "no entry".
    `lemma` is the normalized lookup key (e.g. Arabic with diacritics stripped).
    """
    __tablename__ = "definition_cache"
    __table_args__ = (UniqueConstraint("language_code", "lemma"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    language_code: Mapped[str] = mapped_column(String)
    lemma: Mapped[str] = mapped_column(String)
    entries: Mapped[list] = mapped_column(JSON)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class SessionShare(Base):
    """Grants a user read access to an AnalysisSession owned by someone else.

    A pure join row — the owner is known via AnalysisSession.user_id, so this
    only records who the session is shared *with*. No session data is duplicated.
    """
    __tablename__ = "session_shares"
    __table_args__ = (UniqueConstraint("session_id", "shared_with_user_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(Integer, ForeignKey("analysis_sessions.id"))
    shared_with_user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    session: Mapped["AnalysisSession"] = relationship(back_populates="shares")
    shared_with_user: Mapped["User"] = relationship(
        foreign_keys=[shared_with_user_id], back_populates="received_shares"
    )
