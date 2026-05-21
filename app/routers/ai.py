"""
AI Trip Planner — natural language → a multimodal plan drawn on the map.

POST /api/ai/plan
    body: {"prompt": str, "origin": {"lat": float, "lng": float} | null}

The feature runs in three phases:

  Phase 1 — LM Studio (Gemma) reads the user's free-text message and extracts a
            structured intent: is this an urban trip in Trento/Rovereto, where
            to, and which transport mode is preferred.
  Phase 2 — the backend resolves the named destination against the city's
            mobility catalogue and builds ranked multimodal itineraries with
            the routing engine.
  Phase 3 — the frontend draws the chosen itinerary on the Leaflet map.

When a request can't be fulfilled the response is HTTP 422 carrying a
`capabilities` block so the UI can tell the user what the planner *can* do.
"""

from __future__ import annotations

import json
import os
from typing import Any

import requests
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from rapidfuzz import fuzz, process, utils

from app import trains
from app.geo import haversine_m
from app.routers import routing
from app.routers.routing import LatLng

router = APIRouter(prefix="/api/ai", tags=["ai"])

# ---------------------------------------------------------------------------
# LM Studio — local Gemma model, REST API v1 (/api/v1/chat)
# ---------------------------------------------------------------------------

# The backend runs in Docker, so the default reaches LM Studio on the host
# machine via the Docker bridge. Override with LM_STUDIO_URL when running the
# API outside a container (then http://localhost:1234 is correct).
_LM_STUDIO_BASE = os.getenv("LM_STUDIO_URL", "http://host.docker.internal:1234").rstrip("/")
_LM_STUDIO_MODEL = os.getenv("LM_STUDIO_MODEL", "google/gemma-4-26b-a4b")
_LM_STUDIO_TIMEOUT = float(os.getenv("LM_STUDIO_TIMEOUT", "60"))

# Trento city centre — fallback origin when the client sends no GPS fix.
_DEFAULT_ORIGIN = {"lat": 46.0716, "lng": 11.1185}

# What the planner can actually do — surfaced verbatim in every error so the
# user always gets a constructive answer instead of a dead end.
_CAPABILITIES: dict[str, Any] = {
    "summary": "Sono il pianificatore di CommuteSync: organizzo spostamenti urbani a Trento e Rovereto.",
    "can_do": [
        "Trovare un percorso dalla tua posizione a fermate, stazioni, parcheggi, "
        "posteggi taxi e punti di car sharing",
        "Confrontare le modalità: a piedi, bus urbano, treno regionale, "
        "auto + parcheggio, car sharing, taxi",
        "Disegnare sulla mappa l'itinerario scelto con tempi e costi stimati",
    ],
    "examples": [
        "Portami alla stazione di Trento in autobus",
        "Voglio andare a Rovereto in treno",
        "Come arrivo al MART a piedi",
        "Taxi per l'ospedale Santa Chiara",
    ],
}

# Curated landmarks — high-traffic destinations the bus-stop catalogue names
# poorly (train stations, museums, main squares). Checked before the fuzzy
# catalogue so natural phrasings like "stazione di Trento" resolve correctly.
_LANDMARKS: list[dict[str, Any]] = [
    {
        "name": "Stazione FS Trento", "lat": 46.0716, "lng": 11.1185, "category": "station",
        "aliases": [
            "stazione di trento", "stazione fs trento", "stazione trento",
            "stazione ferroviaria trento", "trento stazione", "stazione centrale trento",
        ],
    },
    {
        "name": "Stazione FS Rovereto", "lat": 45.8906, "lng": 11.0407, "category": "station",
        "aliases": [
            "stazione di rovereto", "stazione fs rovereto", "stazione rovereto",
            "stazione ferroviaria rovereto", "rovereto stazione",
        ],
    },
    {
        "name": "MART Rovereto", "lat": 45.8990, "lng": 11.0428, "category": "poi",
        "aliases": ["mart", "mart rovereto", "museo mart", "museo arte moderna rovereto"],
    },
    {
        "name": "Piazza Duomo, Trento", "lat": 46.0664, "lng": 11.1211, "category": "poi",
        "aliases": [
            "piazza duomo", "piazza duomo trento", "piazza del duomo trento",
            "duomo di trento", "centro di trento", "centro trento",
        ],
    },
    {
        "name": "Ospedale Santa Chiara, Trento", "lat": 46.0539, "lng": 11.1277,
        "category": "poi",
        "aliases": [
            "ospedale santa chiara", "ospedale santa chiara trento",
            "ospedale s chiara", "osp santa chiara", "santa chiara",
            "ospedale di trento", "pronto soccorso trento",
        ],
    },
]

# Flattened (alias, landmark) pairs for fuzzy lookup.
_LANDMARK_ALIASES: list[tuple[str, dict[str, Any]]] = [
    (alias, lm) for lm in _LANDMARKS for alias in lm["aliases"]
]

# LLM mode hint → suggestion id. "transit"/"park"/etc. come from
# routing._build_suggestions; "train" is the itinerary this module appends.
_MODE_TO_SUGGESTION = {
    "walk":     "walk",
    "bus":      "transit",
    "train":    "train",
    "drive":    "park",
    "carshare": "carshare",
    "taxi":     "taxi",
}

_SYSTEM_PROMPT = (
    "You are the intent parser for CommuteSync, a mobility planner for the cities "
    "of Trento and Rovereto, Italy, and the railway corridor between them. The app "
    "plans a trip from the user's current location to a destination, choosing "
    "between walking, the urban bus, the regional train, driving + parking, car "
    "sharing and taxi.\n\n"
    "Read the user's message and reply with ONLY a JSON object — no markdown, no "
    "commentary, no extra text:\n"
    "{\n"
    '  "in_scope": boolean,        // true ONLY if this is a request to travel '
    "somewhere within Trento, Rovereto or along the rail corridor\n"
    '  "destination": string|null, // the place to reach, as a short place name; '
    "null if none is named\n"
    '  "mode": "walk"|"bus"|"train"|"drive"|"carshare"|"taxi"|"any",  // preferred '
    'transport; "any" if unspecified\n'
    '  "restated": string          // ONE short sentence in Italian: restate the '
    "request, OR explain why it is out of scope\n"
    "}\n\n"
    "Rules:\n"
    "- in_scope is false for anything that is not about going somewhere (weather, "
    "jokes, flight/hotel bookings) or for trips outside the modelled area.\n"
    '- Use "train" when the user mentions the train (treno) or for trips between '
    "towns on the railway (Rovereto, Trento, Ala, Calliano, Mezzocorona, Bolzano).\n"
    "- Never invent a destination. If the user names no place, destination is null "
    "and in_scope is false.\n"
    "- Output the JSON object and nothing else.\n\n"
    "Examples:\n"
    'User: "Portami alla stazione di Trento in autobus"\n'
    '{"in_scope": true, "destination": "Stazione di Trento", "mode": "bus", '
    '"restated": "Percorso in autobus verso la stazione di Trento."}\n'
    'User: "voglio andare a Rovereto in treno"\n'
    '{"in_scope": true, "destination": "Stazione di Rovereto", "mode": "train", '
    '"restated": "Percorso in treno verso Rovereto."}\n'
    'User: "che tempo fa domani?"\n'
    '{"in_scope": false, "destination": null, "mode": "any", '
    '"restated": "Posso pianificare spostamenti urbani, non dare previsioni meteo."}\n'
    'User: "voglio volare a Parigi"\n'
    '{"in_scope": false, "destination": null, "mode": "any", '
    '"restated": "Pianifico solo spostamenti dentro Trento e Rovereto."}'
)


# ---------------------------------------------------------------------------
# Request model
# ---------------------------------------------------------------------------


class AIPlanRequest(BaseModel):
    prompt: str
    origin: LatLng | None = None


# ---------------------------------------------------------------------------
# Phase 1 — LM Studio intent extraction
# ---------------------------------------------------------------------------


def _err(status: int, message: str, **extra: Any) -> HTTPException:
    """An HTTPException whose detail always carries the capabilities block."""
    return HTTPException(
        status_code=status,
        detail={"message": message, "capabilities": _CAPABILITIES, **extra},
    )


def _strip_markdown(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        parts = text.split("```")
        text = parts[1] if len(parts) > 1 else text
        if text.startswith("json"):
            text = text[4:]
    return text.strip()


def _first_json_object(text: str) -> str:
    """Slice out the first {...} block — Gemma sometimes wraps it in prose."""
    start = text.find("{")
    if start == -1:
        return text
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return text[start:]


def _extract_text(data: dict[str, Any]) -> str:
    """Pull the assistant text out of an LM Studio REST API v1 response.

    The v1 /api/v1/chat endpoint replies with an `output` array of typed items
    — a "reasoning" block followed by the actual "message". Older / OpenAI-style
    shapes (`choices`, plain `content`) are handled as a fallback.
    """
    out = data.get("output")
    if isinstance(out, list):
        fallback = ""
        for item in out:
            if not isinstance(item, dict) or not item.get("content"):
                continue
            if item.get("type") == "message":
                return str(item["content"])
            if item.get("type") != "reasoning":
                fallback = str(item["content"])
        return fallback

    choices = data.get("choices")
    if choices:
        msg = choices[0].get("message", {})
        if msg.get("content"):
            return str(msg["content"])
        if choices[0].get("text"):
            return str(choices[0]["text"])

    for key in ("content", "output", "response", "text"):
        value = data.get(key)
        if isinstance(value, str) and value:
            return value
    return ""


def _call_lm_studio(system_prompt: str, user_input: str) -> str:
    url = f"{_LM_STUDIO_BASE}/api/v1/chat"
    try:
        resp = requests.post(
            url,
            json={
                "model": _LM_STUDIO_MODEL,
                "system_prompt": system_prompt,
                "input": user_input,
            },
            timeout=_LM_STUDIO_TIMEOUT,
        )
        resp.raise_for_status()
        return _extract_text(resp.json())
    except requests.ConnectionError as exc:
        raise _err(
            503,
            "Il pianificatore AI non è raggiungibile: avvia LM Studio e carica "
            f"il modello {_LM_STUDIO_MODEL}.",
        ) from exc
    except requests.Timeout as exc:
        raise _err(503, "Il pianificatore AI ha impiegato troppo tempo a rispondere.") from exc
    except requests.HTTPError as exc:
        raise _err(503, f"Errore del pianificatore AI ({exc.response.status_code}).") from exc
    except Exception as exc:  # noqa: BLE001
        raise _err(503, f"Pianificatore AI non disponibile: {exc}") from exc


def _parse_intent(prompt: str) -> dict[str, Any]:
    """Call Gemma and coerce its reply into the intent schema (one retry)."""
    raw = _call_lm_studio(_SYSTEM_PROMPT, prompt)
    for candidate in (raw, _maybe_retry(prompt, raw)):
        if candidate is None:
            continue
        try:
            parsed = json.loads(_first_json_object(_strip_markdown(candidate)))
        except (json.JSONDecodeError, TypeError):
            continue
        if isinstance(parsed, dict):
            return _normalise_intent(parsed)

    raise _err(
        422,
        "Non sono riuscito a interpretare la richiesta. Prova a indicare "
        "chiaramente dove vuoi andare.",
    )


def _maybe_retry(prompt: str, first_raw: str) -> str | None:
    """If the first reply already parsed, skip the retry; else re-prompt harder."""
    try:
        json.loads(_first_json_object(_strip_markdown(first_raw)))
        return None
    except (json.JSONDecodeError, TypeError):
        retry_input = (
            f'{prompt}\n\nReply with ONLY the JSON object, starting with "{{". '
            'Example: {"in_scope": true, "destination": "Stazione di Trento", '
            '"mode": "bus", "restated": "..."}'
        )
        return _call_lm_studio(_SYSTEM_PROMPT, retry_input)


def _normalise_intent(parsed: dict[str, Any]) -> dict[str, Any]:
    mode = str(parsed.get("mode") or "any").strip().lower()
    if mode not in _MODE_TO_SUGGESTION and mode != "any":
        mode = "any"
    dest = parsed.get("destination")
    dest = str(dest).strip() if dest else None
    return {
        "in_scope":    bool(parsed.get("in_scope")),
        "destination": dest or None,
        "mode":        mode,
        "restated":    str(parsed.get("restated") or "").strip(),
    }


# ---------------------------------------------------------------------------
# Phase 2 — destination resolution + plan building
# ---------------------------------------------------------------------------


def _resolve_destination(name: str) -> dict[str, Any]:
    """Resolve a place name to coordinates.

    Curated landmarks are tried first (they cover the destinations the bus-stop
    catalogue names poorly), then the full city mobility catalogue.
    """
    query = name.strip()

    # 1. Curated landmarks — tolerant of case, word order and filler words.
    #    default_process lowercases and strips punctuation on both sides.
    alias_choices = {i: alias for i, (alias, _) in enumerate(_LANDMARK_ALIASES)}
    lm_hit = process.extractOne(
        query, alias_choices, scorer=fuzz.token_set_ratio,
        processor=utils.default_process, score_cutoff=82,
    )
    if lm_hit is not None:
        lm = _LANDMARK_ALIASES[lm_hit[2]][1]
        return {
            "lat": lm["lat"], "lng": lm["lng"],
            "name": lm["name"], "category": lm["category"],
        }

    # 2. Fuzzy match against the city's full mobility catalogue.
    places = routing._PLACES
    if not places:
        raise _err(503, "Il catalogo delle destinazioni non è ancora pronto. Riprova tra poco.")

    # A confident wrong match is worse than a helpful "did you mean" — keep the
    # cutoff high so vague / unknown places fall through to the suggestion list.
    choices = {i: p["name"] for i, p in enumerate(places)}
    match = process.extractOne(
        query, choices, scorer=fuzz.WRatio,
        processor=utils.default_process, score_cutoff=84,
    )
    if match is not None:
        p = places[match[2]]
        return {
            "lat":      p["lat"],
            "lng":      p["lng"],
            "name":     p["name"],
            "category": p["category"],
        }

    # No confident match — offer the closest names so the user can retry.
    near = process.extract(
        query, choices, scorer=fuzz.WRatio,
        processor=utils.default_process, limit=4,
    )
    seen: list[str] = []
    for _, _, idx in near:
        label = places[idx]["name"]
        if label not in seen:
            seen.append(label)
    raise _err(
        422,
        f'Non ho trovato "{name}" tra le destinazioni di Trento e Rovereto.',
        did_you_mean=seen,
    )


def _train_suggestion(
    origin_pt: dict[str, Any], dest: dict[str, Any]
) -> dict[str, Any] | None:
    """Build a walk → train → walk itinerary, or None if no train would help."""
    leg = trains.plan_train_leg(
        origin_pt["lat"], origin_pt["lng"], dest["lat"], dest["lng"]
    )
    if leg is None:
        return None

    o_st, d_st = leg["origin_station"], leg["dest_station"]
    walk_to = routing._leg(
        "walk", origin_pt, o_st,
        label_from=origin_pt["name"], label_to=o_st["name"],
    )
    train_leg = {
        "mode":         "train",
        "from":         {"name": o_st["name"], "lat": o_st["lat"], "lng": o_st["lng"]},
        "to":           {"name": d_st["name"], "lat": d_st["lat"], "lng": d_st["lng"]},
        "distance_m":   leg["distance_m"],
        "duration_min": leg["duration_min"],
        "polyline":     leg["polyline"],
    }
    walk_from = routing._leg(
        "walk", d_st, dest,
        label_from=d_st["name"], label_to=dest["name"],
    )
    legs = [walk_to, train_leg, walk_from]

    suggestion = routing._suggestion(
        "train", "Treno", "🚆",
        f"Treno da {o_st['name']} a {d_st['name']}",
        legs, leg["fare_eur"],
    )
    # Upgrade the walking legs to real pavement geometry, then recompute totals.
    routing._enrich_walk_legs([suggestion])
    suggestion["total_distance_m"] = sum(l["distance_m"] for l in suggestion["legs"])
    suggestion["total_duration_min"] = round(
        sum(l["duration_min"] for l in suggestion["legs"]), 1
    )
    return suggestion


def _with_train_option(
    suggestions: list[dict[str, Any]], origin_pt: dict[str, Any], dest: dict[str, Any]
) -> list[dict[str, Any]]:
    """Append a train itinerary when one is available and re-rank the list."""
    train = _train_suggestion(origin_pt, dest)
    if train is None:
        return suggestions

    merged = suggestions + [train]
    merged.sort(key=lambda s: s["total_duration_min"])
    cheapest = min(merged, key=lambda s: s["cost_eur"])
    for i, s in enumerate(merged):
        s["recommended"] = i == 0
        s["cheapest"] = s is cheapest
    return merged


def _pick_suggestion(suggestions: list[dict[str, Any]], mode: str) -> dict[str, Any]:
    """Choose the itinerary matching the user's mode hint, else the fastest."""
    wanted_id = _MODE_TO_SUGGESTION.get(mode)
    if wanted_id:
        for s in suggestions:
            if s["id"] == wanted_id:
                return s
    for s in suggestions:
        if s.get("recommended"):
            return s
    return suggestions[0]


def _format_cost(cost: float) -> str:
    return "gratis" if cost <= 0 else f"€{cost:.2f}".replace(".", ",")


def _summarise(
    chosen: dict[str, Any], dest: dict[str, Any], suggestions: list[dict[str, Any]]
) -> str:
    mins = round(chosen["total_duration_min"])
    summary = (
        f"{chosen['icon']} {chosen['label']} verso {dest['name']}: "
        f"circa {mins} min · {_format_cost(chosen['cost_eur'])}."
    )
    alternatives = len(suggestions) - 1
    if alternatives > 0:
        summary += f" {alternatives} alternative valutate."
    return summary


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


@router.post("/plan")
def ai_plan(payload: AIPlanRequest) -> dict[str, Any]:
    prompt = (payload.prompt or "").strip()
    if not prompt:
        raise _err(422, "Scrivi dove vuoi andare per generare un piano.")

    origin = (
        {"lat": payload.origin.lat, "lng": payload.origin.lng}
        if payload.origin is not None
        else dict(_DEFAULT_ORIGIN)
    )

    # Phase 1 — extract intent via the local Gemma model.
    intent = _parse_intent(prompt)

    if not intent["in_scope"] or not intent["destination"]:
        raise _err(
            422,
            intent["restated"]
            or "Questa richiesta non rientra in ciò che posso pianificare.",
        )

    # Phase 2 — resolve the destination and build multimodal itineraries.
    dest = _resolve_destination(intent["destination"])
    origin_pt = {"lat": origin["lat"], "lng": origin["lng"], "name": "La tua posizione"}
    suggestions = routing._build_suggestions(origin_pt, dest)
    if not suggestions:
        raise _err(422, f"Non ci sono itinerari disponibili verso {dest['name']}.")

    # Add the regional train as an option whenever the rail network helps.
    suggestions = _with_train_option(suggestions, origin_pt, dest)

    chosen = _pick_suggestion(suggestions, intent["mode"])

    return {
        "intent":          intent,
        "origin":          origin_pt,
        "destination":     dest,
        "straight_line_m": round(
            haversine_m(origin["lat"], origin["lng"], dest["lat"], dest["lng"])
        ),
        "suggestions":     suggestions,
        "chosen_id":       chosen["id"],
        "ai_summary":      _summarise(chosen, dest, suggestions),
        "capabilities":    _CAPABILITIES,
    }


@router.get("/capabilities")
def ai_capabilities() -> dict[str, Any]:
    """What the planner can do — used by the UI for its idle/help state."""
    return _CAPABILITIES
