"""
AI Natural Language Trip Planner.

POST /api/ai/plan — accepts a plain-language Italian prompt, calls Gemma 27B
via LM Studio to extract intent, then runs search + auto-select + book
internally and returns a boarding pass.
"""

from __future__ import annotations

import json
import os
from typing import Any

from fastapi import APIRouter, HTTPException
from openai import OpenAI
from pydantic import BaseModel

from app.routers.trips import _run_book_logic, _run_search_logic

router = APIRouter(prefix="/api/ai", tags=["ai"])

_LM_STUDIO_URL = os.getenv("LM_STUDIO_URL", "http://localhost:1234/v1")

_SYSTEM_PROMPT = (
    "You are a trip planning assistant for CommuteSync, a mobility app in Trento/Rovereto, Italy. "
    "Extract the trip intent from the user's message and return ONLY a JSON object with these exact fields:\n"
    '  "destination": the place name in Italian (string)\n'
    '  "modality_hint": one of "train", "parking", "taxi", "bike_sharing", or "any" (string)\n'
    '  "time_hint": time in HH:MM format if mentioned, otherwise null\n'
    "Return ONLY the JSON object — no explanation, no markdown, no extra text.\n"
    'Example: {"destination": "MART Rovereto", "modality_hint": "train", "time_hint": "18:00"}'
)

_MODALITY_PRIORITY = ["train", "taxi", "parking", "bike_sharing"]


class AIPlanRequest(BaseModel):
    prompt: str


def _lm_client() -> OpenAI:
    return OpenAI(base_url=_LM_STUDIO_URL, api_key="lm-studio")


def _strip_markdown(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        parts = text.split("```")
        text = parts[1] if len(parts) > 1 else text
        if text.startswith("json"):
            text = text[4:]
    return text.strip()


def _parse_intent(prompt: str) -> dict[str, Any]:
    try:
        client = _lm_client()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"AI planner unavailable: {exc}") from exc

    try:
        resp = client.chat.completions.create(
            model="local-model",
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=0.1,
            max_tokens=150,
        )
        raw = _strip_markdown(resp.choices[0].message.content or "")
        return json.loads(raw)
    except json.JSONDecodeError:
        # Retry with a primed assistant turn to force JSON
        try:
            resp = client.chat.completions.create(
                model="local-model",
                messages=[
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                    {"role": "assistant", "content": '{"destination": "'},
                ],
                temperature=0.0,
                max_tokens=100,
            )
            raw = '{"destination": "' + (resp.choices[0].message.content or "").strip()
            return json.loads(raw)
        except (json.JSONDecodeError, Exception) as exc:
            raise HTTPException(
                status_code=422, detail="Could not parse trip intent from prompt"
            ) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"AI planner unavailable: {exc}") from exc


def _availability_score(m: dict[str, Any]) -> float:
    t = m["type"]
    if t == "train":
        return m.get("available_seats", 0) / max(m.get("total_seats", 1), 1)
    if t == "parking":
        return m.get("available_spots", 0) / max(m.get("total_spots", 1), 1)
    if t == "bike_sharing":
        total = m.get("available_bikes", 0) + m.get("available_docks", 1)
        return m.get("available_bikes", 0) / max(total, 1)
    return 0.5  # taxi — always dispatchable


def _select_modality(modalities: list[dict[str, Any]], hint: str) -> dict[str, Any]:
    available = [
        m for m in modalities
        if m["type"] == "taxi" or _availability_score(m) > 0
    ]
    if not available:
        raise HTTPException(status_code=409, detail="No resources available for this trip")

    if hint and hint != "any":
        hinted = [m for m in available if m["type"] == hint]
        if hinted:
            return hinted[0]

    def sort_key(m: dict[str, Any]) -> tuple[float, int]:
        score = _availability_score(m)
        priority = _MODALITY_PRIORITY.index(m["type"]) if m["type"] in _MODALITY_PRIORITY else 99
        return (-score, priority)

    return sorted(available, key=sort_key)[0]


@router.post("/plan")
def ai_plan(payload: AIPlanRequest) -> dict[str, Any]:
    intent = _parse_intent(payload.prompt)

    destination   = intent.get("destination", "stazione fs rovereto")
    modality_hint = intent.get("modality_hint", "any") or "any"

    search_result = _run_search_logic(destination)
    chosen        = _select_modality(search_result["modalities"], modality_hint)
    booking       = _run_book_logic(chosen["option_id"])

    bp         = booking["boarding_pass"]
    ai_summary = f"{bp['title']} · {bp['subtitle']}"

    return {
        **booking,
        "ai_summary":    ai_summary,
        "parsed_intent": intent,
    }
