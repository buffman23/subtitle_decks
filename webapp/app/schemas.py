from datetime import datetime
from pydantic import BaseModel, field_validator


class WordFrequency(BaseModel):
    lemma: str
    frequency: int
    ignored: bool = False


class SubtitleSegment(BaseModel):
    lemma: str
    start: int
    length: int
    analysis: dict | None = None


class SubtitleEntry(BaseModel):
    index: int
    start_time: str
    end_time: str
    start_seconds: float
    text: str
    segments: list[SubtitleSegment]


class AnalyzeResponse(BaseModel):
    results: list[WordFrequency]
    total_unique: int
    total_tokens: int
    subtitles: list[SubtitleEntry]


class IgnoreListEntryOut(BaseModel):
    id: int
    word: str
    language: str

    model_config = {"from_attributes": True}


class IgnoreListAddRequest(BaseModel):
    word: str
    language: str


class SessionOut(BaseModel):
    id: int
    name: str
    language: str
    srt_filename: str
    created_at: datetime

    model_config = {"from_attributes": True}


class SessionDetail(BaseModel):
    id: int
    name: str
    language: str
    srt_filename: str
    subtitles: list[SubtitleEntry] = []
    native_subtitles: list[SubtitleEntry] = []
    results: list[WordFrequency]
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_validator('subtitles', 'native_subtitles', mode='before')
    @classmethod
    def coerce_list(cls, v):
        return v or []


class SessionCreateRequest(BaseModel):
    language: str
    srt_filename: str
    subtitles: list[SubtitleEntry]
    native_subtitles: list[SubtitleEntry] = []
    results: list[WordFrequency]


class SessionRenameRequest(BaseModel):
    name: str


class SessionNativeSubtitlesRequest(BaseModel):
    native_subtitles: list[SubtitleEntry]


class JobSubmitResponse(BaseModel):
    job_id: str
    position: int | None = None


class JobStatusResponse(BaseModel):
    status: str  # queued | running | done | failed | cancelled
    position: int | None = None
    result: AnalyzeResponse | None = None
    error: str | None = None


class QueueJobOut(BaseModel):
    id: str
    user_label: str
    language_code: str
    language_name: str
    filename: str
    status: str
    position: int | None = None
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None


class AdminToggleRequest(BaseModel):
    is_admin: bool


class AutoUnloadRequest(BaseModel):
    enabled: bool


class GeneralSettingsRequest(BaseModel):
    # Configured by the admin in KB; stored internally as bytes.
    max_upload_kb: int

    @field_validator("max_upload_kb")
    @classmethod
    def positive(cls, v: int) -> int:
        if v < 1:
            raise ValueError("Maximum upload size must be at least 1 KB.")
        return v


class UserUploadLimitRequest(BaseModel):
    # Per-user override in KB; None clears the override (use the global default).
    max_upload_kb: int | None = None

    @field_validator("max_upload_kb")
    @classmethod
    def positive(cls, v: int | None) -> int | None:
        if v is not None and v < 1:
            raise ValueError("Upload limit must be at least 1 KB.")
        return v
