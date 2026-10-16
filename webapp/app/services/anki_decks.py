"""Per-user deck operations on the shared Anki collection.

Every user's decks are subdecks of a top-level deck named after their email
(e.g. ``someone@example.com::barbarians-de``). This module is the only place
that builds deck names, search queries and media filenames, and every
operation that takes a note/card id from a request first checks the id lives
under the caller's root deck.
"""
import base64
import html
import os
import re
import tempfile
import time
import uuid
from dataclasses import dataclass

from fastapi import HTTPException

from app.config import settings
from app.models import User
from app.services import anki_client
from app.services.anki_client import MODEL_NAME, invoke

MAX_DECK_NAME_LEN = 100
_FORBIDDEN_DECK_CHARS = re.compile(r'["\\\x00-\x1f]')
# Anki shows learning cards up to this far ahead when nothing else is due
# (Anki's default "learn ahead limit").
_LEARN_AHEAD_SECS = 20 * 60


# ---------------------------------------------------------------------------
# Names, queries, ownership
# ---------------------------------------------------------------------------

def user_root(user: User) -> str:
    return user.email


def validate_deck_name(name: str) -> str:
    """Normalize a user-supplied (short) deck name or raise HTTP 422."""
    name = (name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="Deck name is required.")
    if len(name) > MAX_DECK_NAME_LEN:
        raise HTTPException(status_code=422, detail=f"Deck name must be at most {MAX_DECK_NAME_LEN} characters.")
    if "::" in name or _FORBIDDEN_DECK_CHARS.search(name):
        raise HTTPException(status_code=422, detail='Deck name cannot contain "::", quotes or backslashes.')
    return name


def full_deck(user: User, name: str) -> str:
    return f"{user_root(user)}::{validate_deck_name(name)}"


def _escape_search(value: str) -> str:
    # Inside a quoted Anki search term, \ and " must be escaped, and * and _
    # are wildcards (emails often contain "_").
    return re.sub(r'([\\"*_])', r"\\\1", value)


def deck_query(full_name: str) -> str:
    """Search term matching a deck and its subdecks."""
    return f'"deck:{_escape_search(full_name)}"'


def _root_query(user: User) -> str:
    return deck_query(user_root(user))


def assert_note_owned(user: User, note_id: int) -> None:
    if not invoke("findNotes", query=f"nid:{int(note_id)} {_root_query(user)}"):
        raise HTTPException(status_code=404, detail="Note not found.")


def assert_card_owned(user: User, card_id: int) -> None:
    if not invoke("findCards", query=f"cid:{int(card_id)} {_root_query(user)}"):
        raise HTTPException(status_code=404, detail="Card not found.")


def require_deck(user: User, name: str) -> str:
    """Full name of one of the user's existing decks, or 404."""
    full = full_deck(user, name)
    if full not in (invoke("deckNames") or []):
        raise HTTPException(status_code=404, detail="Deck not found.")
    return full


# ---------------------------------------------------------------------------
# Field <-> text conversion
# ---------------------------------------------------------------------------

def media_prefix(user: User) -> str:
    return f"sd_{user.id}_"


def new_media_name(user: User, ext: str) -> str:
    return f"{media_prefix(user)}{uuid.uuid4().hex}{ext.lower()}"


def owns_media(user: User, filename: str) -> bool:
    return filename.startswith(media_prefix(user)) and "/" not in filename and "\\" not in filename


def text_to_field(text: str) -> str:
    return html.escape((text or "").strip()).replace("\n", "<br>")


def field_to_text(value: str) -> str:
    value = re.sub(r"<br\s*/?>", "\n", value or "", flags=re.I)
    value = re.sub(r"<[^>]+>", "", value)
    return html.unescape(value)


def image_field(filename: str | None) -> str:
    return f'<img src="{html.escape(filename)}">' if filename else ""


def audio_field(filename: str | None) -> str:
    return f"[sound:{filename}]" if filename else ""


def _image_name(value: str) -> str | None:
    m = re.search(r'<img[^>]*src="([^"]+)"', value or "")
    return html.unescape(m.group(1)) if m else None


def _audio_name(value: str) -> str | None:
    m = re.search(r"\[sound:([^\]]+)\]", value or "")
    return m.group(1) if m else None


@dataclass
class CardContent:
    """One note's content as plain text plus media filenames."""
    word: str
    native: str = ""
    example_foreign: str = ""
    example_native: str = ""
    image: str | None = None
    audio: str | None = None

    def to_fields(self) -> dict[str, str]:
        return {
            "Word": text_to_field(self.word),
            "Native": text_to_field(self.native),
            "ExampleForeign": text_to_field(self.example_foreign),
            "ExampleNative": text_to_field(self.example_native),
            "Image": image_field(self.image),
            "Audio": audio_field(self.audio),
        }


def _note_out(info: dict) -> dict:
    f = {k: v.get("value", "") for k, v in (info.get("fields") or {}).items()}
    return {
        "note_id": info["noteId"],
        "word": field_to_text(f.get("Word", "")),
        "native": field_to_text(f.get("Native", "")),
        "example_foreign": field_to_text(f.get("ExampleForeign", "")),
        "example_native": field_to_text(f.get("ExampleNative", "")),
        "image": _image_name(f.get("Image", "")),
        "audio": _audio_name(f.get("Audio", "")),
    }


# ---------------------------------------------------------------------------
# Decks
# ---------------------------------------------------------------------------

def list_decks(user: User) -> list[dict]:
    prefix = user_root(user) + "::"
    with anki_client.locked():
        ids = {n: i for n, i in (invoke("deckNamesAndIds") or {}).items() if n.startswith(prefix)}
        if not ids:
            return []
        # Keyed by deck id; each entry's "name" is only the leaf name.
        stats = invoke("getDeckStats", decks=list(ids)) or {}
    out = []
    for full in sorted(ids):
        s = stats.get(str(ids[full]), {})
        out.append({
            "name": full[len(prefix):],
            "new": s.get("new_count", 0),
            "learn": s.get("learn_count", 0),
            "review": s.get("review_count", 0),
            "total": s.get("total_in_deck", 0),
        })
    return out


def store_media(filename: str, data: bytes) -> None:
    invoke("storeMediaFile", filename=filename, data=base64.b64encode(data).decode("ascii"))


def add_notes(user: User, deck_name: str, cards: list[CardContent]) -> tuple[int, int]:
    """Add notes to one of the user's decks (created if missing).

    Returns (added, skipped) — notes whose Word already exists in the deck are
    skipped rather than duplicated.
    """
    full = full_deck(user, deck_name)
    anki_client.ensure_model()
    notes, seen = [], set()
    for c in cards:
        fields = c.to_fields()
        # canAddNotes only checks against the collection, and addNotes rolls
        # back the whole batch on any error, so drop in-batch duplicates here.
        if fields["Word"] in seen:
            continue
        seen.add(fields["Word"])
        notes.append({
            "deckName": full,
            "modelName": MODEL_NAME,
            "fields": fields,
            "tags": ["subtitle-decks"],
            "options": {"allowDuplicate": False, "duplicateScope": "deck"},
        })
    with anki_client.locked():
        invoke("createDeck", deck=full)
        addable = invoke("canAddNotes", notes=notes) or []
        to_add = [n for n, ok in zip(notes, addable) if ok]
        added = [nid for nid in (invoke("addNotes", notes=to_add) or []) if nid] if to_add else []
    return len(added), len(cards) - len(added)


def deck_notes(user: User, deck_name: str) -> list[dict]:
    with anki_client.locked():
        full = require_deck(user, deck_name)
        note_ids = invoke("findNotes", query=deck_query(full)) or []
        infos = invoke("notesInfo", notes=note_ids) if note_ids else []
    return [_note_out(i) for i in sorted(infos, key=lambda i: i["noteId"])]


def get_note(user: User, note_id: int) -> dict:
    with anki_client.locked():
        assert_note_owned(user, note_id)
        return _note_out(invoke("notesInfo", notes=[note_id])[0])


def update_note(user: User, note_id: int, content: CardContent) -> None:
    with anki_client.locked():
        assert_note_owned(user, note_id)
        invoke("updateNoteFields", note={"id": note_id, "fields": content.to_fields()})


def delete_media(user: User, filenames) -> None:
    for name in filenames:
        if name and owns_media(user, name):
            invoke("deleteMediaFile", filename=name)


def delete_note(user: User, note_id: int) -> None:
    with anki_client.locked():
        note = get_note(user, note_id)
        invoke("deleteNotes", notes=[note_id])
        delete_media(user, [note["image"], note["audio"]])


def delete_deck(user: User, deck_name: str) -> None:
    with anki_client.locked():
        notes = deck_notes(user, deck_name)
        invoke("deleteDecks", decks=[full_deck(user, deck_name)], cardsToo=True)
        delete_media(user, [m for n in notes for m in (n["image"], n["audio"])])


def retrieve_media(user: User, filename: str) -> bytes | None:
    if not owns_media(user, filename):
        return None
    data = invoke("retrieveMediaFile", filename=filename)
    return base64.b64decode(data) if data else None


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

def _export_dirs() -> tuple[str, str]:
    """(dir as Anki sees it, same dir as this app sees it)."""
    anki_dir, app_dir = settings.ANKI_EXPORT_DIR_ANKI, settings.ANKI_EXPORT_DIR_APP
    if not anki_dir or not app_dir:
        anki_dir = app_dir = os.path.join(tempfile.gettempdir(), "subtitle_decks_exports")
    os.makedirs(app_dir, exist_ok=True)
    return anki_dir.rstrip("/\\"), app_dir


def export_apkg(user: User, deck_name: str) -> str:
    """Export a deck (with scheduling) and return the local .apkg path.

    The caller is responsible for deleting the file.
    """
    anki_dir, app_dir = _export_dirs()
    fname = f"sd_{user.id}_{uuid.uuid4().hex}.apkg"
    with anki_client.locked():
        full = require_deck(user, deck_name)
        invoke("exportPackage", deck=full, path=f"{anki_dir}/{fname}", includeSched=True)
    return os.path.join(app_dir, fname)


def deck_package(user: User, deck_name: str) -> dict:
    """Everything the browser needs to recreate the deck in a local Anki."""
    notes = deck_notes(user, deck_name)
    media = {}
    with anki_client.locked():
        for n in notes:
            for name in (n["image"], n["audio"]):
                if name and name not in media:
                    data = invoke("retrieveMediaFile", filename=name)
                    if data:
                        media[name] = data
    return {
        "deck": validate_deck_name(deck_name),
        "model": anki_client.model_definition(),
        "notes": [CardContent(**{k: v for k, v in n.items() if k != "note_id"}).to_fields() for n in notes],
        "media": media,
    }


# ---------------------------------------------------------------------------
# Study (Anki's own scheduler, via AnkiConnect)
# ---------------------------------------------------------------------------

# Candidates read per queue when picking the next card; cardsInfo is heavy
# (it renders each card), and new/review order only needs the head.
_CANDIDATES = 50


def _queue_slice(card_ids: list[int]) -> list[int]:
    return sorted(card_ids)[:_CANDIDATES]


def next_card(user: User, deck_name: str) -> dict:
    """The next card to study plus today's remaining counts.

    Order: learning cards due now, due reviews, then new cards (within the
    deck's daily new limit); if none, learning cards due within the learn-ahead
    limit. Two AnkiConnect round trips.
    """
    full = full_deck(user, deck_name)
    q = deck_query(full)
    with anki_client.locked():
        names, learn_due, reviews, new, learning = anki_client.invoke_multi([
            ("deckNames", {}),
            ("findCards", {"query": f"{q} is:learn is:due"}),
            ("findCards", {"query": f"{q} is:review is:due -is:learn"}),
            ("findCards", {"query": f"{q} is:new"}),
            ("findCards", {"query": f"{q} is:learn"}),
        ])
        # Checked before getDeckStats, which would create a missing deck.
        if full not in (names or []):
            raise HTTPException(status_code=404, detail="Deck not found.")
        candidates = sorted(set(learning) | set(_queue_slice(reviews)) | set(_queue_slice(new)))
        stats, infos = anki_client.invoke_multi([
            ("getDeckStats", {"decks": [full]}),
            ("cardsInfo", {"cards": candidates}),
        ])
    s = next(iter((stats or {}).values()), {})
    counts = {"new": s.get("new_count", 0), "learn": s.get("learn_count", 0), "review": s.get("review_count", 0)}
    by_id = {c["cardId"]: c for c in infos if c}

    def first(ids, predicate=lambda c: True):
        pool = [by_id[i] for i in ids if i in by_id and predicate(by_id[i])]
        return min(pool, key=lambda c: (c["due"], c["cardId"])) if pool else None

    # Anki's is:due already includes intraday learning cards (queue 1, whose
    # "due" is an epoch timestamp) inside the learn-ahead window; only those
    # due *now* go before reviews and new cards.
    now = time.time()
    card = first(learn_due, lambda c: c.get("queue") != 1 or c.get("due", 0) <= now)
    if card is None and counts["review"] > 0:
        card = first(reviews)
    if card is None and counts["new"] > 0:
        card = first(new)
    if card is None:
        card = first(learning, lambda c: c.get("queue") == 1 and c.get("due", 0) <= now + _LEARN_AHEAD_SECS)
    if card is None:
        return {"card": None, "counts": counts}
    note = _note_out({"noteId": card["note"], "fields": card["fields"]})
    return {
        "card": {
            "card_id": card["cardId"],
            # 0 = Forward (foreign -> native), 1 = Reverse (native -> foreign)
            "ord": card.get("ord", 0),
            "queue": card.get("queue"),
            # Interval each answer button would give, e.g. ["<1m", "<6m", "<10m", "4d"]
            # (Anki wraps the numbers in Unicode isolate marks).
            "next_intervals": [re.sub("[\u2066-\u2069]", "", s) for s in card.get("nextReviews") or []],
            **note,
        },
        "counts": counts,
    }


def answer(user: User, card_id: int, ease: int) -> None:
    if ease not in (1, 2, 3, 4):
        raise HTTPException(status_code=422, detail="Ease must be 1-4.")
    with anki_client.locked():
        assert_card_owned(user, card_id)
        result = invoke("answerCards", answers=[{"cardId": int(card_id), "ease": ease}])
    if not result or not result[0]:
        raise HTTPException(status_code=409, detail="Card could not be answered.")
