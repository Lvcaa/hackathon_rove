import React, { useState, useRef, useEffect } from 'react';
import { RouteSuggestion, MODE_META } from '../types/routing';
import { useAIPlanner } from '../hooks/useAIPlanner';
import { AI_PROMPT_PRESETS } from '../constants/aiPresets';

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

    /* Rotating placeholder prompt: a soft gradient mask sweeps left-to-right.
       One continuous pass reveals the phrase (left edge first), holds it, then
       wipes it away (left edge first) — same direction throughout. The text is
       swapped while fully wiped out, so the next phrase then appears with the
       same left-to-right wipe. */
    @keyframes aip-preset {
      from { -webkit-mask-position: 100% 0; mask-position: 100% 0; }
      to   { -webkit-mask-position: 0% 0;   mask-position: 0% 0; }
    }
    .aip-preset-text {
      -webkit-mask-image: linear-gradient(to right, transparent 14%, #000 27%, #000 73%, transparent 86%);
      mask-image: linear-gradient(to right, transparent 14%, #000 27%, #000 73%, transparent 86%);
      -webkit-mask-size: 600% 100%; mask-size: 600% 100%;
      -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
      animation: aip-preset 4s linear forwards;
      will-change: -webkit-mask-position, mask-position;
    }
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
  const [focused, setFocused] = useState(false);
  const [presetIdx, setPresetIdx] = useState(
    () => Math.floor(Math.random() * AI_PROMPT_PRESETS.length),
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const { state, plan, reset } = useAIPlanner();

  useEffect(() => { injectStyles(); }, []);

  // Hand the chosen itinerary to the map once a plan is ready.
  useEffect(() => {
    if (state.phase === 'ready' && state.chosen) onPlanReady(state.chosen);
  }, [state.phase, state.chosen, onPlanReady]);

  // The placeholder cycles through example prompts only while the field is
  // idle, empty and unfocused — clicking in to type pauses it immediately.
  const rotating = state.phase === 'idle' && !focused && input === '';
  useEffect(() => {
    if (!rotating) return;
    const id = window.setInterval(() => {
      setPresetIdx((i) => (i + 1) % AI_PROMPT_PRESETS.length);
    }, 4000);
    return () => window.clearInterval(id);
  }, [rotating]);

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
    <div style={{
      ...PANEL,
      ...(state.phase === 'idle' && { padding: 0, overflow: 'hidden' }),
    }}>
      {/* Header — all non-idle states */}
      {state.phase !== 'idle' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
          <span style={{ fontSize: 14, color: C.cyan }}>✦</span>
          <span style={{
            fontSize: 10.5, fontWeight: 800, color: C.cyan,
            letterSpacing: '0.12em', textTransform: 'uppercase',
          }}>
            AI Planner
          </span>
          <button
            onClick={handleReset}
            style={{
              marginLeft: 'auto', background: 'transparent', border: 'none',
              color: C.muted, fontSize: 11, cursor: 'pointer', fontFamily: FONT, padding: 0,
            }}
          >
            ✕ nuovo
          </button>
        </div>
      )}

      {/* IDLE: matches search bar layout exactly — transparent input, full-height button */}
      {state.phase === 'idle' && (
        <div style={{ display: 'flex', alignItems: 'stretch' }}>
          {/* Left: badge + transparent input */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 11, padding: '14px 0 14px 14px' }}>
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" style={{ flexShrink: 0 }}>
              <path d="M7.5 1.5L8.75 6.25L13.5 7.5L8.75 8.75L7.5 13.5L6.25 8.75L1.5 7.5L6.25 6.25Z" fill="#00e5ff"/>
            </svg>
            <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submit(input); }}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                placeholder={rotating ? '' : 'Scrivi dove vuoi andare…'}
                style={{
                  width: '100%', background: 'transparent', border: 'none',
                  color: C.text, fontSize: 15, fontWeight: 500,
                  fontFamily: FONT, outline: 'none', letterSpacing: '-0.01em',
                }}
              />
              {rotating && (
                <div
                  aria-hidden
                  style={{
                    position: 'absolute', inset: 0, display: 'flex',
                    alignItems: 'center', pointerEvents: 'none', overflow: 'hidden',
                  }}
                >
                  <span
                    key={presetIdx}
                    className="aip-preset-text"
                    style={{
                      display: 'block', fontSize: 15, color: C.muted,
                      fontFamily: FONT, whiteSpace: 'nowrap', letterSpacing: '-0.01em',
                    }}
                  >
                    {AI_PROMPT_PRESETS[presetIdx]}
                  </span>
                </div>
              )}
            </div>
          </div>
          {/* Full-height submit button — clipped to panel border-radius by overflow:hidden */}
          <button
            onClick={() => submit(input)}
            style={{
              background: C.cyan, color: '#04121a', border: 'none',
              padding: '0 18px', fontSize: 16, fontWeight: 800,
              cursor: 'pointer', fontFamily: FONT, flexShrink: 0,
            }}
          >
            →
          </button>
        </div>
      )}

      {/* ERROR: header shown above, standard input row */}
      {state.phase === 'error' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(input); }}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="Scrivi dove vuoi andare…"
              style={{
                width: '100%', boxSizing: 'border-box', background: C.surface,
                border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10,
                padding: '9px 12px', fontSize: 13, color: C.text,
                fontFamily: FONT, outline: 'none',
              }}
            />
          </div>
          <button
            onClick={() => submit(input)}
            style={{
              background: C.cyan, color: '#04121a', border: 'none', borderRadius: 10,
              padding: '0 15px', fontSize: 15, fontWeight: 800, cursor: 'pointer',
            }}
          >→</button>
        </div>
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
