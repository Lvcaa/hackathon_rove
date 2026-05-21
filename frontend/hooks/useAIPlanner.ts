import { useState, useCallback, useRef } from 'react';
import { AIPlanResponse, AIPlanError, AICapabilities, RouteSuggestion } from '../types/routing';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';

export type AIPlannerPhase = 'idle' | 'thinking' | 'ready' | 'error';

interface Origin { lat: number; lng: number; }

export interface AIPlannerState {
  phase: AIPlannerPhase;
  prompt: string | null;
  result: AIPlanResponse | null;
  /** The single itinerary the planner picked — drawn on the map. */
  chosen: RouteSuggestion | null;
  error: string | null;
  capabilities: AICapabilities | null;
  didYouMean: string[] | null;
}

const INITIAL: AIPlannerState = {
  phase: 'idle',
  prompt: null,
  result: null,
  chosen: null,
  error: null,
  capabilities: null,
  didYouMean: null,
};

// Pull a normalised AIPlanError out of whatever `detail` shape the API sent.
// The backend always sends an object, but stay defensive for plain strings.
function readError(body: unknown, status: number): AIPlanError {
  const detail = (body as { detail?: unknown })?.detail;
  if (detail && typeof detail === 'object') {
    return detail as AIPlanError;
  }
  return {
    message: typeof detail === 'string' ? detail : `Errore del pianificatore (${status}).`,
    capabilities: { summary: '', can_do: [], examples: [] },
  };
}

/**
 * Drives POST /api/ai/plan: sends the user's free-text prompt (plus their live
 * position when available) and exposes the resulting multimodal plan, or a
 * helpful capabilities error when the request can't be fulfilled.
 */
export function useAIPlanner() {
  const [state, setState] = useState<AIPlannerState>(INITIAL);
  const reqId = useRef(0);

  const plan = useCallback(async (prompt: string, origin?: Origin | null) => {
    const trimmed = prompt.trim();
    if (!trimmed) return;

    const id = ++reqId.current;
    setState({ ...INITIAL, phase: 'thinking', prompt: trimmed });

    try {
      const res = await fetch(`${API_BASE}/api/ai/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: trimmed,
          origin: origin ? { lat: origin.lat, lng: origin.lng } : null,
        }),
      });

      const body = await res.json().catch(() => ({}));
      if (id !== reqId.current) return;

      if (!res.ok) {
        const err = readError(body, res.status);
        setState({
          phase: 'error',
          prompt: trimmed,
          result: null,
          chosen: null,
          error: err.message,
          capabilities: err.capabilities,
          didYouMean: err.did_you_mean ?? null,
        });
        return;
      }

      const data = body as AIPlanResponse;
      const chosen =
        data.suggestions.find((s) => s.id === data.chosen_id) ??
        data.suggestions[0] ??
        null;

      setState({
        phase: 'ready',
        prompt: trimmed,
        result: data,
        chosen,
        error: null,
        capabilities: data.capabilities,
        didYouMean: null,
      });
    } catch (err) {
      if (id !== reqId.current) return;
      setState({
        phase: 'error',
        prompt: trimmed,
        result: null,
        chosen: null,
        error: `Impossibile contattare il pianificatore: ${(err as Error).message}`,
        capabilities: null,
        didYouMean: null,
      });
    }
  }, []);

  const reset = useCallback(() => {
    reqId.current++;
    setState(INITIAL);
  }, []);

  return { state, plan, reset };
}
