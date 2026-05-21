# AI Natural Language Trip Planner — Design Spec

**Date:** 2026-05-21
**Project:** CommuteSync — Hackathon Rove / Campionato Universitario AI 2026
**Branch:** book_parkingspot (feature work)

---

## 1. Goal

Allow users to describe a trip in plain Italian ("Portami al MART sabato sera") and have CommuteSync automatically parse the intent, find the best available modality, and book it — returning a boarding pass with zero extra clicks.

This is the "wow factor" differentiator: a fully transactional AI planner vs. a simple search form.

---

## 2. Architecture

**Backend-orchestrated (Option A).** All AI logic lives in a new FastAPI router. The frontend sends one prompt and receives one boarding pass. No direct browser-to-LM-Studio communication.

```
Frontend → POST /api/ai/plan
         → Backend calls LM Studio (Gemma 27B) at LM_STUDIO_URL
         → Parses JSON intent from model response
         → Calls internal search_trips() logic
         → Auto-selects best available modality
         → Calls internal book_trip() logic
         → Returns AIPlanResponse (boarding pass + ai_summary + parsed_intent)
```

---

## 3. New Files

| File | Purpose |
|---|---|
| `app/routers/ai.py` | New FastAPI router — `POST /api/ai/plan` |
| `frontend/components/AIChatBubble.web.tsx` | AI input bubble component |
| `frontend/hooks/useAIPlanner.ts` | Hook managing AI planner state machine |

---

## 4. Modified Files

| File | Change |
|---|---|
| `app/routers/trips.py` | Extract `_run_search()` and `_run_book()` as internal async functions callable from `ai.py` |
| `app/main.py` | Register `ai.router` |
| `frontend/components/BookingSheet.web.tsx` | Mount `AIChatBubble` below the search bar with an "oppure" divider |
| `.env.example` | Add `LM_STUDIO_URL=http://localhost:1234/v1` |

---

## 5. Backend — `POST /api/ai/plan`

### Request
```json
{ "prompt": "Portami al MART sabato sera" }
```

### LM Studio call
- Model: value of `LM_STUDIO_URL` env var (default: `http://localhost:1234/v1`)
- OpenAI-compatible SDK, `base_url` pointed at LM Studio
- `model` field set to `"local-model"` (LM Studio ignores it, uses whatever is loaded)
- Temperature: `0.1` (deterministic JSON output)
- System prompt instructs Gemma to return **only** a JSON object:
```json
{
  "destination": "<place name>",
  "modality_hint": "<train|parking|taxi|bike_sharing|any>",
  "time_hint": "<HH:MM or null>"
}
```
- If Gemma returns malformed JSON → retry once with a stricter prompt that includes a concrete example
- If second attempt also fails → raise HTTP 422

### Auto-selection logic
1. Call `_run_search(destination)` — same logic as existing `/api/trips/search`
2. Filter out modalities with zero availability
3. If `modality_hint` matches an available modality → pick it
4. Otherwise → pick the modality with the highest availability ratio (available / total)
5. Taxi has no pool — always available, lowest priority unless hinted
6. If nothing is available → raise HTTP 409

### Response — `AIPlanResponse`
```json
{
  "boarding_pass": { ...TripBookResponse... },
  "ai_summary": "Treno 18:42 + Parcheggio A14",
  "parsed_intent": {
    "destination": "MART Rovereto",
    "modality_hint": "train",
    "time_hint": "18:00"
  }
}
```

### Error responses
| Status | Condition |
|---|---|
| 503 | LM Studio unreachable |
| 422 | Gemma returned unparseable JSON after retry |
| 409 | No modality has available resources |

---

## 6. Frontend — `AIChatBubble.web.tsx`

Three render states driven by `useAIPlanner`:

**idle** — input field with placeholder "Dimmi dove vuoi andare..." and a `✦ AI PLANNER` label. Sits below the existing search bar, separated by an "oppure" divider.

**thinking** — shows the user's submitted prompt, then a pulsing "Pianificazione in corso…" indicator, then step labels that appear sequentially:
1. `✓ Destinazione: <parsed destination>`
2. `✓ Ricerca disponibilità...`
3. `◌ Prenotazione in corso...`

Steps 1 and 2 appear immediately on submit. Step 3 appears when the API call resolves.

**confirmed** — transitions the parent `BookingSheet` into its existing `confirmed` phase using the `TripBookResponse` embedded in `AIPlanResponse`. No new confirmed UI needed.

---

## 7. Frontend — `useAIPlanner.ts`

```typescript
type AIPlannerPhase = 'idle' | 'thinking' | 'confirmed' | 'error';

interface AIPlannerState {
  phase: AIPlannerPhase;
  prompt: string | null;
  parsedDestination: string | null;
  aiSummary: string | null;
  error: string | null;
}
```

Exposes `{ state, plan(prompt) }`. On success, calls an `onConfirmed(bookResponse: TripBookResponse)` callback provided by `BookingSheet` so the existing boarding pass UI takes over.

---

## 8. Environment

```bash
# .env / .env.example
LM_STUDIO_URL=http://localhost:1234/v1
```

Inside Docker the backend reaches LM Studio on the host via `host.docker.internal:1234`. The env var default uses `localhost:1234` for direct Python runs; Docker Compose should override with `http://host.docker.internal:1234/v1`.

---

## 9. Out of Scope

- Streaming token-by-token response (adds complexity, not needed for demo)
- Multi-modality chain booking (train + parking simultaneously) — existing `/api/trips/book` books one at a time; auto-select picks the single best option
- Voice input
- Conversation history / follow-up prompts
