import React, { useEffect, useRef, useState } from 'react';
import { useRouting } from '../hooks/useRouting';
import { LiveLocation, LocationStatus } from '../hooks/useLiveLocation';
import { RouteSuggestion, RouteLeg, MODE_META } from '../types/routing';

interface Props {
  origin: LiveLocation | null;
  locationStatus: LocationStatus;
  target: { name: string; lat: number; lng: number } | null;
  onEnableLocation: () => void;
  onClose: () => void;
  onRouteSelect: (suggestion: RouteSuggestion | null) => void;
  onBook: (destinationName: string) => void;
}

const ACCENT = '#00e5ff';

// ── CSS injection ─────────────────────────────────────────────────────────────

function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById('cs-routing-styles')) return;
  const s = document.createElement('style');
  s.id = 'cs-routing-styles';
  s.textContent = `
    @keyframes cs-route-in {
      from { opacity: 0; transform: translateX(-14px) scale(0.97); }
      to   { opacity: 1; transform: translateX(0)     scale(1); }
    }
    @keyframes cs-route-card-in {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes cs-route-spin { to { transform: rotate(360deg); } }
    .cs-route-panel { animation: cs-route-in 0.34s cubic-bezier(0.16,1,0.3,1) both; }
    .cs-route-card  { animation: cs-route-card-in 0.26s ease both; }
    .cs-route-scroll::-webkit-scrollbar { width: 6px; }
    .cs-route-scroll::-webkit-scrollbar-thumb {
      background: rgba(255,255,255,0.14); border-radius: 3px;
    }
  `;
  document.head.appendChild(s);
}

// ── Formatting ─────────────────────────────────────────────────────────────────

const fmtCost = (eur: number) =>
  eur <= 0 ? 'Gratis' : `€ ${eur.toFixed(2).replace('.', ',')}`;

const fmtDist = (m: number) =>
  m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;

const fmtDur = (min: number) => `${Math.max(1, Math.round(min))} min`;

// ── Leg sequence chips ─────────────────────────────────────────────────────────

function LegSequence({ legs }: { legs: RouteLeg[] }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginTop: 9 }}>
      {legs.map((leg, i) => {
        const m = MODE_META[leg.mode];
        return (
          <React.Fragment key={i}>
            {i > 0 && (
              <span style={{ color: 'rgba(255,255,255,0.28)', fontSize: 11, fontWeight: 700 }}>›</span>
            )}
            <span style={{
              display: 'flex', alignItems: 'center', gap: 3,
              background: m.color + '1f', border: `1px solid ${m.color}3d`,
              borderRadius: 6, padding: '2px 6px',
              fontSize: 10, fontWeight: 700, color: m.color,
            }}>
              <span style={{ fontSize: 11 }}>{m.icon}</span>
              <span>{Math.max(1, Math.round(leg.duration_min))}′</span>
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Suggestion card ────────────────────────────────────────────────────────────

function SuggestionCard({ s, selected, onSelect, index }: {
  s: RouteSuggestion;
  selected: boolean;
  onSelect: () => void;
  index: number;
}) {
  return (
    <div
      className="cs-route-card"
      onClick={onSelect}
      style={{
        animationDelay: `${index * 45}ms`,
        cursor: 'pointer', borderRadius: 12, padding: '11px 12px',
        background: selected ? ACCENT + '1c' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${selected ? ACCENT + '88' : 'rgba(255,255,255,0.09)'}`,
        boxShadow: selected ? `0 0 0 1px ${ACCENT}33, 0 6px 18px rgba(0,0,0,0.4)` : 'none',
        transition: 'background 0.16s ease, border-color 0.16s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <div style={{
          width: 34, height: 34, borderRadius: 9, flexShrink: 0,
          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17,
        }}>
          {s.icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{s.label}</span>
            {s.recommended && (
              <span style={{
                fontSize: 8.5, fontWeight: 800, letterSpacing: '0.05em',
                color: '#34d399', background: '#34d39922',
                border: '1px solid #34d39955', borderRadius: 4, padding: '1px 5px',
              }}>CONSIGLIATO</span>
            )}
            {s.cheapest && !s.recommended && (
              <span style={{
                fontSize: 8.5, fontWeight: 800, letterSpacing: '0.05em',
                color: ACCENT, background: ACCENT + '22',
                border: `1px solid ${ACCENT}55`, borderRadius: 4, padding: '1px 5px',
              }}>ECONOMICO</span>
            )}
          </div>
          <div style={{
            fontSize: 10.5, color: 'rgba(255,255,255,0.5)', marginTop: 2,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{s.summary}</div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', lineHeight: 1.1 }}>
            {fmtDur(s.total_duration_min)}
          </div>
          <div style={{ fontSize: 10.5, color: ACCENT, fontWeight: 700, marginTop: 1 }}>
            {fmtCost(s.cost_eur)}
          </div>
        </div>
      </div>
      <LegSequence legs={s.legs} />
      <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.35)', marginTop: 7, fontWeight: 600 }}>
        {fmtDist(s.total_distance_m)} totali
      </div>
    </div>
  );
}

// ── Itinerary header (origin → destination) ────────────────────────────────────

function ItineraryHeader({ originLabel, destLabel }: { originLabel: string; destLabel: string }) {
  const row = (dot: React.ReactNode, label: string, muted?: boolean) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <div style={{ width: 16, display: 'flex', justifyContent: 'center' }}>{dot}</div>
      <span style={{
        fontSize: 12, fontWeight: 600,
        color: muted ? 'rgba(255,255,255,0.55)' : '#fff',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{label}</span>
    </div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {row(<div style={{
        width: 9, height: 9, borderRadius: '50%',
        background: '#3b82f6', border: '2px solid #fff',
      }} />, originLabel, true)}
      <div style={{
        width: 2, height: 12, marginLeft: 7,
        background: 'rgba(255,255,255,0.18)',
      }} />
      {row(<div style={{
        width: 11, height: 11, borderRadius: '50% 50% 50% 0',
        transform: 'rotate(-45deg)', background: '#ec4899', border: '2px solid #fff',
      }} />, destLabel)}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function RoutingPanel({
  origin, locationStatus, target,
  onEnableLocation, onClose, onRouteSelect, onBook,
}: Props) {
  const { status, response, error, fetchRoutes, reset } = useRouting();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => { injectStyles(); }, []);

  // Fetch once per destination, as soon as a live origin is available.
  const fetchedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!target || !origin) return;
    const key = `${target.lat.toFixed(5)},${target.lng.toFixed(5)}`;
    if (fetchedFor.current === key) return;
    fetchedFor.current = key;
    fetchRoutes({ lat: origin.lat, lng: origin.lng }, target);
  }, [target, origin, fetchRoutes]);

  // Auto-select the recommended itinerary when results arrive.
  useEffect(() => {
    if (status === 'ready' && response) {
      const rec = response.suggestions.find((s) => s.recommended) ?? response.suggestions[0];
      setSelectedId(rec?.id ?? null);
    }
  }, [status, response]);

  // Surface the selected itinerary to the map.
  useEffect(() => {
    const sel = response?.suggestions.find((s) => s.id === selectedId) ?? null;
    onRouteSelect(sel);
  }, [selectedId, response, onRouteSelect]);

  // Clear the drawn route when the panel goes away.
  useEffect(() => () => { onRouteSelect(null); reset(); }, [onRouteSelect, reset]);

  const selected = response?.suggestions.find((s) => s.id === selectedId) ?? null;
  const noLocation = locationStatus === 'idle' || locationStatus === 'error';

  return (
    <div
      className="cs-route-panel"
      style={{
        position: 'absolute', top: 14, left: 14, zIndex: 1100,
        width: 'min(360px, calc(100vw - 28px))',
        maxHeight: 'calc(100vh - 28px)',
        display: 'flex', flexDirection: 'column',
        background: 'rgba(13,14,20,0.82)',
        backdropFilter: 'blur(30px) saturate(180%)',
        WebkitBackdropFilter: 'blur(30px) saturate(180%)',
        border: '1px solid rgba(255,255,255,0.13)',
        borderRadius: 18,
        boxShadow: '0 24px 64px rgba(0,0,0,0.66), inset 0 1px 0 rgba(255,255,255,0.1)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '13px 14px 11px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}>
        <span style={{ fontSize: 15 }}>🧭</span>
        <span style={{
          flex: 1, fontSize: 11, fontWeight: 800, letterSpacing: '0.09em',
          color: 'rgba(255,255,255,0.7)',
        }}>INDICAZIONI</span>
        <div
          onClick={onClose}
          title="Chiudi"
          style={{
            width: 26, height: 26, borderRadius: 7, cursor: 'pointer',
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'rgba(255,255,255,0.55)', fontSize: 15, lineHeight: 1,
          }}
        >×</div>
      </div>

      {/* Itinerary header */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <ItineraryHeader
          originLabel={origin ? 'La tua posizione' : 'Posizione non attiva'}
          destLabel={target?.name ?? 'Destinazione'}
        />
        {response && (
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 9, fontWeight: 600 }}>
            {fmtDist(response.straight_line_m)} in linea d'aria · {response.suggestions.length} opzioni
          </div>
        )}
      </div>

      {/* Body */}
      <div
        className="cs-route-scroll"
        style={{ overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        {noLocation && (
          <div style={{ textAlign: 'center', padding: '14px 4px' }}>
            <div style={{ fontSize: 26, marginBottom: 8 }}>📍</div>
            <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.75)', fontWeight: 600, lineHeight: 1.45 }}>
              {locationStatus === 'error'
                ? 'Posizione non disponibile.'
                : 'Attiva la geolocalizzazione per calcolare il percorso dalla tua posizione.'}
            </div>
            <div
              onClick={onEnableLocation}
              style={{
                marginTop: 12, background: ACCENT + '1c', border: `1px solid ${ACCENT}77`,
                borderRadius: 9, padding: '9px 0', textAlign: 'center', cursor: 'pointer',
                fontSize: 12, fontWeight: 800, color: ACCENT,
              }}
            >
              {locationStatus === 'error' ? 'Riprova' : 'Attiva la posizione'}
            </div>
          </div>
        )}

        {!noLocation && locationStatus === 'locating' && !response && (
          <div style={{ textAlign: 'center', padding: '20px 4px', color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: 600 }}>
            <div style={{
              width: 22, height: 22, margin: '0 auto 10px', borderRadius: '50%',
              border: '2px solid rgba(255,255,255,0.18)', borderTopColor: ACCENT,
              animation: 'cs-route-spin 0.8s linear infinite',
            }} />
            Individuazione della posizione…
          </div>
        )}

        {status === 'loading' && (
          <div style={{ textAlign: 'center', padding: '20px 4px', color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: 600 }}>
            <div style={{
              width: 22, height: 22, margin: '0 auto 10px', borderRadius: '50%',
              border: '2px solid rgba(255,255,255,0.18)', borderTopColor: ACCENT,
              animation: 'cs-route-spin 0.8s linear infinite',
            }} />
            Calcolo dei percorsi…
          </div>
        )}

        {status === 'error' && (
          <div style={{ textAlign: 'center', padding: '16px 4px', color: '#f87171', fontSize: 12, fontWeight: 600 }}>
            {error ?? 'Impossibile calcolare il percorso'}
          </div>
        )}

        {status === 'ready' && response && response.suggestions.map((s, i) => (
          <SuggestionCard
            key={s.id}
            s={s}
            index={i}
            selected={s.id === selectedId}
            onSelect={() => setSelectedId(s.id)}
          />
        ))}
      </div>

      {/* Footer — book the selected itinerary */}
      {selected && target && (
        <div style={{ padding: '11px 14px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <div
            onClick={() => onBook(target.name)}
            style={{
              background: `linear-gradient(135deg, ${ACCENT}, #0891b2)`,
              borderRadius: 10, padding: '11px 0', textAlign: 'center', cursor: 'pointer',
              fontSize: 13, fontWeight: 800, color: '#04222a',
              boxShadow: `0 6px 20px ${ACCENT}3d`,
            }}
          >
            Prenota · {selected.label} · {fmtDur(selected.total_duration_min)}
          </div>
        </div>
      )}
    </div>
  );
}
