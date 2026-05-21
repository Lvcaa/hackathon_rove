import React, { useState, useRef, useEffect } from 'react';
import { RouteSuggestion, MODE_META } from '../types/routing';
import { useAIPlanner } from '../hooks/useAIPlanner';

const FONT = "'Inter', 'SF Pro Display', system-ui, sans-serif";
const C = {
  bg:      'rgba(15,18,28,0.82)',
  surface: 'rgba(255,255,255,0.05)',
  border:  'rgba(0,229,255,0.28)',
  cyan:    '#00e5ff',
  green:   '#34d399',
  amber:   '#fbbf24',
  muted:   '#8b93a7',
  text:    '#f5f5f5',
  error:   '#f87171',
};

interface Origin { lat: number; lng: number; }

interface Props {
  origin: Origin | null;
  /** Fired with the itinerary the planner chose — draw it on the map. */
  onPlanReady: (suggestion: RouteSuggestion) => void;
  /** Fired when the plan is dismissed — clear the route from the map. */
  onClear: () => void;
  /** Ask the host to start geolocation (so the next plan routes from the user). */
  onRequestLocation?: () => void;
}

function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById('ai-planner-styles')) return;
  const s = document.createElement('style');
  s.id = 'ai-planner-styles';
  s.textContent = `
    @keyframes aip-dot { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.25;transform:scale(0.6)} }
    @keyframes aip-in  { from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:translateY(0)} }
    .aip-dot  { width:5px;height:5px;border-radius:50%;background:#00e5ff;display:inline-block;
                animation:aip-dot 1.1s ease-in-out infinite; }
    .aip-step { animation:aip-in 0.3s ease forwards; }
    .aip-chip { transition:background 0.13s ease,border-color 0.13s ease; }
    .aip-chip:hover { background:rgba(0,229,255,0.14) !important; border-color:rgba(0,229,255,0.5) !important; }
  `;
  document.head.appendChild(s);
}

// Inline card — the host (the booking sheet column) positions it.
const PANEL: React.CSSProperties = {
  width: '100%',
  background: C.bg,
  backdropFilter: 'blur(26px) saturate(180%)',
  WebkitBackdropFilter: 'blur(26px) saturate(180%)',
  border: `1px solid ${C.border}`,
  borderRadius: 18,
  boxShadow: '0 18px 48px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08)',
  padding: '13px 15px',
  fontFamily: FONT,
  boxSizing: 'border-box',
};

function fmtCost(eur: number): string {
  return eur <= 0 ? 'gratis' : `€${eur.toFixed(2).replace('.', ',')}`;
}

// One row per leg: mode badge + endpoint + duration.
function PlanLegs({ suggestion }: { suggestion: RouteSuggestion }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
      {suggestion.legs.map((leg, i) => {
        const m = MODE_META[leg.mode];
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              width: 22, height: 22, borderRadius: 7, flexShrink: 0,
              background: m.color + '22', border: `1px solid ${m.color}66`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11,
            }}>{m.icon}</span>
            <span style={{
              flex: 1, fontSize: 11.5, color: 'rgba(255,255,255,0.82)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {m.label} → {leg.to.name}
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, color: m.color, flexShrink: 0 }}>
              {Math.round(leg.duration_min)}′
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Chips({ items, onPick }: {
  items: string[];
  onPick: (v: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 7 }}>
      {items.map((it) => (
        <button
          key={it}
          className="aip-chip"
          onClick={() => onPick(it)}
          style={{
            background: C.surface, border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 8, padding: '5px 9px', fontSize: 11, color: 'rgba(255,255,255,0.85)',
            cursor: 'pointer', fontFamily: FONT, textAlign: 'left',
          }}
        >
          {it}
        </button>
      ))}
    </div>
  );
}

export default function AIPlannerPanel({ origin, onPlanReady, onClear, onRequestLocation }: Props) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { state, plan, reset } = useAIPlanner();

  useEffect(() => { injectStyles(); }, []);

  // Hand the chosen itinerary to the map once a plan is ready.
  useEffect(() => {
    if (state.phase === 'ready' && state.chosen) onPlanReady(state.chosen);
  }, [state.phase, state.chosen, onPlanReady]);

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || state.phase === 'thinking') return;
    if (!origin) onRequestLocation?.();
    plan(trimmed, origin);
  };

  const handleReset = () => {
    setInput('');
    reset();
    onClear();
  };

  const isInput = state.phase === 'idle' || state.phase === 'error';

  return (
    <div style={PANEL}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: isInput ? 9 : 8 }}>
        <span style={{ fontSize: 14, color: C.cyan }}>✦</span>
        <span style={{
          fontSize: 10.5, fontWeight: 800, color: C.cyan,
          letterSpacing: '0.12em', textTransform: 'uppercase',
        }}>
          AI Planner
        </span>
        {state.phase !== 'idle' && (
          <button
            onClick={handleReset}
            style={{
              marginLeft: 'auto', background: 'transparent', border: 'none',
              color: C.muted, fontSize: 11, cursor: 'pointer', fontFamily: FONT, padding: 0,
            }}
          >
            ✕ nuovo
          </button>
        )}
      </div>

      {/* Input — shown while idle or after an error */}
      {isInput && (
        <>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(input); }}
              placeholder="Dimmi dove vuoi andare…"
              style={{
                flex: 1, background: C.surface,
                border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10,
                padding: '9px 12px', fontSize: 13, color: C.text,
                fontFamily: FONT, outline: 'none',
              }}
            />
            <button
              onClick={() => submit(input)}
              style={{
                background: C.cyan, color: '#04121a', border: 'none', borderRadius: 10,
                padding: '0 15px', fontSize: 15, fontWeight: 800, cursor: 'pointer',
              }}
            >
              →
            </button>
          </div>

          {state.phase === 'idle' && (
            <>
              <p style={{ fontSize: 10.5, color: C.muted, margin: '8px 2px 0', fontWeight: 600 }}>
                Prova una di queste richieste:
              </p>
              <Chips
                items={[
                  'Portami alla stazione di Trento in autobus',
                  'Come arrivo al MART a piedi',
                  'Taxi per l’ospedale Santa Chiara',
                ]}

                onPick={(v) => { setInput(v); submit(v); }}
              />
            </>
          )}
        </>
      )}

      {/* Thinking */}
      {state.phase === 'thinking' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div style={{
            background: C.surface, borderRadius: 9, padding: '8px 11px',
            fontSize: 12.5, color: C.text,
          }}>
            “{state.prompt}”
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '1px 3px' }}>
            <div className="aip-step" style={{ fontSize: 11.5, color: C.green }}>
              ✓ Richiesta inviata al modello Gemma
            </div>
            <div className="aip-step" style={{ fontSize: 11.5, color: C.green, animationDelay: '0.15s' }}>
              ✓ Interpretazione dell’intento
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: C.muted }}>
              <span>◌ Calcolo dell’itinerario</span>
              <span style={{ display: 'inline-flex', gap: 3 }}>
                <span className="aip-dot" />
                <span className="aip-dot" style={{ animationDelay: '0.2s' }} />
                <span className="aip-dot" style={{ animationDelay: '0.4s' }} />
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Ready — the plan */}
      {state.phase === 'ready' && state.result && state.chosen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{
            fontSize: 12.5, color: C.text, fontWeight: 600, lineHeight: 1.45,
          }}>
            {state.result.ai_summary}
          </div>

          <div style={{
            marginTop: 9, background: C.surface, borderRadius: 11,
            border: `1px solid ${C.green}33`, padding: '10px 11px',
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>
                {state.chosen.icon} {state.chosen.label}
              </span>
              {state.chosen.recommended && (
                <span style={{
                  fontSize: 8.5, fontWeight: 800, color: C.green,
                  border: `1px solid ${C.green}66`, borderRadius: 5, padding: '1px 5px',
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                }}>consigliato</span>
              )}
              <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 800, color: C.cyan }}>
                {Math.round(state.chosen.total_duration_min)} min
              </span>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: C.amber }}>
                {fmtCost(state.chosen.cost_eur)}
              </span>
            </div>
            <PlanLegs suggestion={state.chosen} />
          </div>

          <p style={{ fontSize: 10, color: C.muted, margin: '8px 2px 0' }}>
            L’itinerario è disegnato sulla mappa.
          </p>
        </div>
      )}

      {/* Error — with a helpful list of what the planner CAN do */}
      {state.phase === 'error' && (
        <div style={{ marginTop: 10 }}>
          <div style={{
            background: 'rgba(248,113,113,0.1)', border: `1px solid ${C.error}40`,
            borderRadius: 10, padding: '9px 11px', fontSize: 12, color: '#fecaca',
            fontWeight: 500, lineHeight: 1.45,
          }}>
            {state.error}
          </div>

          {state.didYouMean && state.didYouMean.length > 0 && (
            <>
              <p style={{ fontSize: 10.5, color: C.muted, margin: '9px 2px 0', fontWeight: 700 }}>
                Forse cercavi:
              </p>
              <Chips
                items={state.didYouMean}

                onPick={(v) => { setInput(v); submit(`Portami a ${v}`); }}
              />
            </>
          )}

          {state.capabilities && state.capabilities.can_do.length > 0 && (
            <div style={{
              marginTop: 11, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 9,
            }}>
              <p style={{ fontSize: 10.5, color: C.cyan, margin: '0 2px 5px', fontWeight: 700 }}>
                Cosa posso fare
              </p>
              {state.capabilities.can_do.map((c) => (
                <div key={c} style={{
                  display: 'flex', gap: 6, fontSize: 11, color: 'rgba(255,255,255,0.78)',
                  padding: '2px 2px', lineHeight: 1.4,
                }}>
                  <span style={{ color: C.green }}>•</span>
                  <span>{c}</span>
                </div>
              ))}
              {state.capabilities.examples.length > 0 && (
                <>
                  <p style={{ fontSize: 10.5, color: C.muted, margin: '8px 2px 0', fontWeight: 700 }}>
                    Esempi che funzionano:
                  </p>
                  <Chips
                    items={state.capabilities.examples}

                    onPick={(v) => { setInput(v); submit(v); }}
                  />
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
