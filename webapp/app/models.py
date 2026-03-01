import enum
from datetime import datetime
from sqlalchemy import Integer, SmallInteger, String, Text, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.database import Base


class Language(enum.IntEnum):
    ar_msa = 1
    ar_egy = 2

    @classmethod
    def from_code(cls, code: str) -> "Language":
        _map = {"ar-msa": cls.ar_msa, "ar-egy": cls.ar_egy}
        try:
            return _map[code]
        except KeyError:
            raise ValueError(f"Unknown language code: {code!r}")

    @property
    def code(self) -> str:
        return {Language.ar_msa: "ar-msa", Language.ar_egy: "ar-egy"}[self]


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
    __table_args__ = (UniqueConstraint("user_id", "word", "language"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"))
    word: Mapped[str] = mapped_column(String)
    language: Mapped[int] = mapped_column(SmallInteger)  # stores Language enum value

    user: Mapped["User"] = relationship(back_populates="ignore_list_entries")


class AnalysisSession(Base):
    __tablename__ = "analysis_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String)
    language: Mapped[str] = mapped_column(String)
    srt_filename: Mapped[str] = mapped_column(String)
    srt_content: Mapped[str] = mapped_column(Text)
    results: Mapped[list] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    user: Mapped["User"] = relationship(back_populates="sessions")
