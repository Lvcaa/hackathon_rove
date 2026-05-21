import React from 'react';
import { RouteSuggestion } from '../types/routing';

interface Props {
  suggestions: RouteSuggestion[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Accent colour for the selected chip — lets each host panel theme it. */
  accent?: string;
}

/**
 * A horizontal, scrollable row of transport-mode chips — one per itinerary the
 * router returned. Picking a chip selects that itinerary (and, via the host,
 * draws it on the map). Shared by the destination search and the AI planner.
 */
export default function ModeChips({ suggestions, selectedId, onSelect, accent = '#00e5ff' }: Props) {
  if (suggestions.length === 0) return null;
  return (
    <div
      style={{
        display: 'flex', gap: 6, overflowX: 'auto',
        paddingBottom: 3, scrollbarWidth: 'none',
      }}
    >
      {suggestions.map((s) => {
        const sel = s.id === selectedId;
        return (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            title={s.summary}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
              background: sel ? accent + '22' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${sel ? accent + '99' : 'rgba(255,255,255,0.12)'}`,
              borderRadius: 9, padding: '6px 10px', cursor: 'pointer',
              color: sel ? accent : 'rgba(255,255,255,0.72)',
              fontSize: 11, fontWeight: 700, fontFamily: 'inherit',
              whiteSpace: 'nowrap', transition: 'background 0.13s ease, border-color 0.13s ease',
            }}
          >
            <span style={{ fontSize: 13 }}>{s.icon}</span>
            <span>{s.label}</span>
            <span style={{ opacity: 0.65, fontWeight: 600 }}>
              {Math.max(1, Math.round(s.total_duration_min))}′
            </span>
          </button>
        );
      })}
    </div>
  );
}
