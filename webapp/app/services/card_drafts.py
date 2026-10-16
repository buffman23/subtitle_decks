"""Storage for the image/audio files uploaded while drafting cards.

Files live under CARD_MEDIA_DIR/<draft id>/<media id><ext> until the draft is
submitted (they are then copied into Anki's media folder) or discarded. The
directory is removed whenever a CardDraft row is deleted, including cascades
from deleting its session or user.
"""
import os
import re
import shutil

from sqlalchemy import event

from app.config import settings
from app.models import CardDraft

IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
}
AUDIO_TYPES = {
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/mp4": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/aac": ".aac",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/webm": ".webm",
}
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_AUDIO_BYTES = 10 * 1024 * 1024

_MEDIA_ID = re.compile(r"^[0-9a-f]{32}$")


def draft_dir(draft_id: int) -> str:
    return os.path.join(settings.CARD_MEDIA_DIR, str(int(draft_id)))


def media_path(draft_id: int, media_id: str, mime: str) -> str | None:
    """Path of an uploaded file, or None if the id/type is invalid."""
    ext = IMAGE_TYPES.get(mime) or AUDIO_TYPES.get(mime)
    if not ext or not _MEDIA_ID.match(media_id or ""):
        return None
    return os.path.join(draft_dir(draft_id), media_id + ext)


def find_media(draft_id: int, media_id: str) -> tuple[str, str] | None:
    """(path, mime) of an uploaded file looked up by id alone."""
    if not _MEDIA_ID.match(media_id or ""):
        return None
    for mime, ext in {**IMAGE_TYPES, **AUDIO_TYPES}.items():
        path = os.path.join(draft_dir(draft_id), media_id + ext)
        if os.path.isfile(path):
            return path, mime
    return None


def remove_draft_media(draft_id: int) -> None:
    shutil.rmtree(draft_dir(draft_id), ignore_errors=True)


@event.listens_for(CardDraft, "after_delete")
def _cleanup_media(mapper, connection, target: CardDraft) -> None:
    remove_draft_media(target.id)
