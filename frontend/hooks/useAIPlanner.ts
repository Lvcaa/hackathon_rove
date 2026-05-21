import { useState, useCallback } from 'react';
import { TripBookResponse } from '../types/booking';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';

export type AIPlannerPhase = 'idle' | 'thinking' | 'confirmed' | 'error';

export interface AIPlannerState {
  phase: AIPlannerPhase;
  prompt: string | null;
  parsedDestination: string | null;
  aiSummary: string | null;
  error: string | null;
}

const INITIAL: AIPlannerState = {
  phase: 'idle',
  prompt: null,
  parsedDestination: null,
  aiSummary: null,
  error: null,
};

export function useAIPlanner(onConfirmed: (booking: TripBookResponse) => void) {
  const [state, setState] = useState<AIPlannerState>(INITIAL);

  const plan = useCallback(async (prompt: string) => {
    setState({ phase: 'thinking', prompt, parsedDestination: null, aiSummary: null, error: null });

    try {
      const res = await fetch(`${API_BASE}/api/ai/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? `Errore AI (${res.status})`);
      }

      const data = await res.json();

      setState({
        phase: 'confirmed',
        prompt,
        parsedDestination: data.parsed_intent?.destination ?? null,
        aiSummary: data.ai_summary ?? null,
        error: null,
      });

      onConfirmed(data as TripBookResponse);
    } catch (err) {
      setState((prev) => ({ ...prev, phase: 'error', error: String(err) }));
    }
  }, [onConfirmed]);

  const reset = useCallback(() => setState(INITIAL), []);

  return { state, plan, reset };
}
