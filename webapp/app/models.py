from datetime import datetime
from sqlalchemy import Integer, String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.database import Base


class LanguageRow(Base):
    __tablename__ = "languages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String, unique=True)
    name: Mapped[str] = mapped_column(String)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True, index=True)

    ignore_list_entries: Mapped[list["IgnoreListEntry"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    sessions: Mapped[list["AnalysisSession"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
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

    user: Mapped["User"] = relationship(back_populates="sessions")
    language_row: Mapped["LanguageRow"] = relationship()

    @property
    def language(self) -> str:
        return self.language_row.code
