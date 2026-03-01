import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy.orm import Session

from app.dependencies import get_db, get_current_user, resolve_language_id
from app.models import IgnoreListEntry
from app.schemas import AnalyzeResponse
from app.services.frequency_analyzer import analyze

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["analysis"])


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_srt(
    request: Request,
    file: UploadFile = File(...),
    language: str = Form("ar-msa"),
    ignore_list_text: str = Form(""),
    db: Session = Depends(get_db),
):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    # Parse plaintext ignore list (newline-separated lemmas)
    uploaded_words: list[str] = [w.strip() for w in ignore_list_text.splitlines() if w.strip()]
    ignore_set: set[str] = set(uploaded_words)

    user = get_current_user(request, db)
    if user:
        lang_id = resolve_language_id(language, db)
        # Save any uploaded words to the user's DB ignore list
        if uploaded_words:
            existing = {
                e.word for e in db.query(IgnoreListEntry)
                .filter(IgnoreListEntry.user_id == user.id, IgnoreListEntry.language_id == lang_id)
                .all()
            }
            new_entries = [
                IgnoreListEntry(user_id=user.id, word=w, language_id=lang_id)
                for w in uploaded_words if w not in existing
            ]
            if new_entries:
                db.bulk_save_objects(new_entries)
                db.commit()

        # Merge full DB ignore list into ignore_set
        for entry in (
            db.query(IgnoreListEntry)
            .filter(IgnoreListEntry.user_id == user.id, IgnoreListEntry.language_id == lang_id)
            .all()
        ):
            ignore_set.add(entry.word)

    try:
        results, total_unique, total_tokens = analyze(content, language, ignore_set)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("Analysis error: %s", exc)
        raise HTTPException(status_code=500, detail="Analysis failed.")

    return AnalyzeResponse(results=results, total_unique=total_unique, total_tokens=total_tokens)
