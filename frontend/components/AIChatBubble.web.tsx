import React, { useState, useRef, useEffect } from 'react';
import { TripBookResponse } from '../types/booking';
import { useAIPlanner } from '../hooks/useAIPlanner';

const FONT = "'Inter', 'SF Pro Display', system-ui, sans-serif";
const C = {
  bg:      '#0f172a',
  surface: '#1a1f2e',
  border:  'rgba(0,229,255,0.25)',
  cyan:    '#00e5ff',
  green:   '#34d399',
  muted:   '#6b7280',
  text:    '#f5f5f5',
  error:   '#ef4444',
};

interface Props {
  onConfirmed: (booking: TripBookResponse) => void;
}

export default function AIChatBubble({ onConfirmed }: Props) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { state, plan, reset } = useAIPlanner(onConfirmed);

  // Pulse animation injected once
  useEffect(() => {
    if (document.getElementById('ai-bubble-styles')) return;
    const s = document.createElement('style');
    s.id = 'ai-bubble-styles';
    s.textContent = `
      @keyframes ai-dot { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.25;transform:scale(0.7)} }
      @keyframes ai-fadein { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
      .ai-dot { width:5px;height:5px;border-radius:50%;background:#00e5ff;display:inline-block;animation:ai-dot 1.1s ease-in-out infinite; }
      .ai-step { animation:ai-fadein 0.3s ease forwards; }
    `;
    document.head.appendChild(s);
  }, []);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed || state.phase === 'thinking') return;
    plan(trimmed);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
  };

  const handleReset = () => {
    setInput('');
    reset();
  };

  return (
    <div style={{
      background: C.bg,
      border: `1px solid ${C.border}`,
      borderRadius: 16,
      padding: '12px 14px',
      fontFamily: FONT,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: 13, color: C.cyan }}>✦</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: C.cyan, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          AI Planner
        </span>
        {state.phase !== 'idle' && (
          <button
            onClick={handleReset}
            style={{
              marginLeft: 'auto', background: 'transparent', border: 'none',
              color: C.muted, fontSize: 11, cursor: 'pointer', padding: '0 4px',
            }}
          >
            ✕ reset
          </button>
        )}
      </div>

      {/* Idle — input */}
      {(state.phase === 'idle' || state.phase === 'error') && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder='Dimmi dove vuoi andare...'
              style={{
                flex: 1,
                background: C.surface,
                border: `1px solid rgba(255,255,255,0.08)`,
                borderRadius: 9,
                padding: '8px 11px',
                fontSize: 13,
                color: C.text,
                fontFamily: FONT,
                outline: 'none',
              }}
            />
            <button
              onClick={handleSubmit}
              style={{
                background: C.cyan, color: '#000', border: 'none',
                borderRadius: 9, padding: '8px 14px',
                fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: FONT,
              }}
            >
              →
            </button>
          </div>
          {state.phase === 'idle' && (
            <p style={{ fontSize: 10.5, color: C.muted, margin: '6px 2px 0' }}>
              es. "Portami al MART sabato sera" · "Taxi per la stazione"
            </p>
          )}
          {state.phase === 'error' && (
            <p style={{ fontSize: 11, color: C.error, margin: '6px 2px 0' }}>
              {state.error}
            </p>
          )}
        </>
      )}

      {/* Thinking */}
      {state.phase === 'thinking' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* User prompt bubble */}
          <div style={{
            background: C.surface, borderRadius: 8, padding: '7px 11px',
            fontSize: 13, color: C.text,
          }}>
            "{state.prompt}"
          </div>

          {/* Step indicators */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '2px 2px' }}>
            <div className="ai-step" style={{ fontSize: 11.5, color: C.green }}>
              ✓ Destinazione rilevata
            </div>
            <div className="ai-step" style={{ fontSize: 11.5, color: C.green, animationDelay: '0.15s' }}>
              ✓ Ricerca disponibilità...
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: C.muted }}>
              <span>◌ Prenotazione in corso</span>
              <span style={{ display: 'inline-flex', gap: 3 }}>
                <span className="ai-dot" style={{ animationDelay: '0s' }} />
                <span className="ai-dot" style={{ animationDelay: '0.2s' }} />
                <span className="ai-dot" style={{ animationDelay: '0.4s' }} />
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
