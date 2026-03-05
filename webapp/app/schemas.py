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
