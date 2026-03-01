from datetime import datetime
from pydantic import BaseModel


class WordFrequency(BaseModel):
    lemma: str
    frequency: int
    ignored: bool = False


class AnalyzeResponse(BaseModel):
    results: list[WordFrequency]
    total_unique: int
    total_tokens: int


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
    srt_content: str
    results: list[WordFrequency]
    created_at: datetime

    model_config = {"from_attributes": True}


class SessionCreateRequest(BaseModel):
    name: str | None = None
    language: str
    srt_filename: str
    srt_content: str
    results: list[WordFrequency]


class SessionRenameRequest(BaseModel):
    name: str
