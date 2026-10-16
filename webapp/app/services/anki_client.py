"""Thin client for the server-side AnkiConnect instance.

Every user's decks live in this one Anki collection; per-user scoping is done
by app.services.anki_decks, which is the only module that should build deck
names or search queries. This module only knows how to talk to AnkiConnect
and how to set up the shared note type.
"""
import threading

import httpx

from app.config import settings

ANKICONNECT_VERSION = 6
_TIMEOUT = httpx.Timeout(30.0, connect=3.0)

# The collection is single-writer and AnkiConnect handles one request at a
# time anyway; serializing here keeps multi-step sequences (e.g. "find cards,
# then read them") from interleaving between users.
_lock = threading.RLock()


class AnkiUnavailable(Exception):
    """AnkiConnect could not be reached."""


class AnkiError(Exception):
    """AnkiConnect answered with an error."""


def invoke(action: str, **params):
    payload: dict = {"action": action, "version": ANKICONNECT_VERSION, "params": params}
    if settings.ANKICONNECT_KEY:
        payload["key"] = settings.ANKICONNECT_KEY
    with _lock:
        try:
            resp = httpx.post(settings.ANKICONNECT_URL, json=payload, timeout=_TIMEOUT)
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise AnkiUnavailable(str(exc)) from exc
    body = resp.json()
    if body.get("error"):
        raise AnkiError(f"{action}: {body['error']}")
    return body.get("result")


def invoke_multi(calls: list[tuple[str, dict]]) -> list:
    """Run several actions in one AnkiConnect round trip (each request has a
    fixed latency of a few hundred ms); raises on the first failed action."""
    actions = [{"action": a, "version": ANKICONNECT_VERSION, "params": p} for a, p in calls]
    results = invoke("multi", actions=actions)
    out = []
    for (action, _), r in zip(calls, results):
        if isinstance(r, dict) and r.get("error"):
            raise AnkiError(f"{action}: {r['error']}")
        out.append(r.get("result") if isinstance(r, dict) else r)
    return out


def locked():
    """Hold the client lock across several invoke() calls (re-entrant)."""
    return _lock


# ---------------------------------------------------------------------------
# Shared note type
# ---------------------------------------------------------------------------

MODEL_NAME = "SubtitleDecks"
FIELDS = ["Word", "Native", "ExampleForeign", "ExampleNative", "Image", "Audio"]

_CSS = """\
.card { font-family: system-ui, sans-serif; font-size: 22px; text-align: center;
        color: #212529; background: #fff; }
.word { font-size: 40px; font-weight: 600; }
.native { font-size: 30px; }
.example { font-size: 20px; margin-top: 14px; color: #495057; }
.image img { max-width: 100%; max-height: 300px; margin-top: 12px; }
.nightMode.card, .night_mode .card { color: #e9ecef; background: #212529; }
.nightMode .example, .night_mode .example { color: #adb5bd; }
"""

_FORWARD_FRONT = """\
<div class="word">{{Word}} {{Audio}}</div>
{{#ExampleForeign}}<div class="example">{{ExampleForeign}}</div>{{/ExampleForeign}}"""

_FORWARD_BACK = """\
{{FrontSide}}
<hr id="answer">
<div class="native">{{Native}}</div>
{{#ExampleNative}}<div class="example">{{ExampleNative}}</div>{{/ExampleNative}}
{{#Image}}<div class="image">{{Image}}</div>{{/Image}}"""

_REVERSE_FRONT = """\
<div class="native">{{Native}}</div>
{{#Image}}<div class="image">{{Image}}</div>{{/Image}}"""

_REVERSE_BACK = """\
{{FrontSide}}
<hr id="answer">
<div class="word">{{Word}} {{Audio}}</div>
{{#ExampleForeign}}<div class="example">{{ExampleForeign}}</div>{{/ExampleForeign}}
{{#ExampleNative}}<div class="example">{{ExampleNative}}</div>{{/ExampleNative}}"""


def model_definition() -> dict:
    """createModel params for the shared note type (also used by the browser
    when it recreates the note type in a user's local Anki)."""
    return {
        "modelName": MODEL_NAME,
        "inOrderFields": FIELDS,
        "css": _CSS,
        "isCloze": False,
        "cardTemplates": [
            {"Name": "Forward", "Front": _FORWARD_FRONT, "Back": _FORWARD_BACK},
            {"Name": "Reverse", "Front": _REVERSE_FRONT, "Back": _REVERSE_BACK},
        ],
    }


_model_ready = False


def ensure_model() -> None:
    """Create the SubtitleDecks note type on first use, or bring an existing
    one up to date (templates/CSS, and drop fields no longer in FIELDS, e.g.
    the former "Definition")."""
    global _model_ready
    if _model_ready:
        return
    with _lock:
        if MODEL_NAME not in (invoke("modelNames") or []):
            invoke("createModel", **model_definition())
        else:
            existing = invoke("modelFieldNames", modelName=MODEL_NAME) or []
            stale = [f for f in existing if f not in FIELDS]
            if stale:
                model = model_definition()
                # Templates first, so none still references a removed field.
                invoke("updateModelTemplates", model={
                    "name": MODEL_NAME,
                    "templates": {t["Name"]: {"Front": t["Front"], "Back": t["Back"]} for t in model["cardTemplates"]},
                })
                invoke("updateModelStyling", model={"name": MODEL_NAME, "css": model["css"]})
                for field in stale:
                    invoke("modelFieldRemove", modelName=MODEL_NAME, fieldName=field)
        _model_ready = True
