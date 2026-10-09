import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.dependencies import get_db
from app.services import dictionary

logger = logging.getLogger(__name__)

# Public (the demo page uses it too); the DB cache bounds outbound Wiktionary traffic.
router = APIRouter(prefix="/api/definitions", tags=["definitions"])


# Plain `def`: the Wiktionary request and DB cache are blocking, so FastAPI runs
# this in its threadpool instead of on the event loop.
@router.get("/{code}")
def get_definitions(
    code: str,
    lemma: str = Query(..., min_length=1, max_length=100),
    db: Session = Depends(get_db),
):
    if not dictionary.is_supported(code):
        raise HTTPException(status_code=404, detail=f"No dictionary for language: {code!r}")
    try:
        entries = dictionary.lookup(db, code, lemma)
    except dictionary.DictionaryUnavailable as exc:
        logger.warning("Definition lookup failed (%s, %r): %s", code, lemma, exc)
        raise HTTPException(status_code=502, detail="The dictionary could not be reached.")
    return {"lemma": lemma, "entries": entries, "source": "wiktionary"}
