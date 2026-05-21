import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouting } from '../hooks/useRouting';
import { useDestinationSearch } from '../hooks/useDestinationSearch';
import { LiveLocation, LocationStatus } from '../hooks/useLiveLocation';
import {
  RouteSuggestion, RouteLeg, PlaceResult, MODE_META, PLACE_ICON,
} from '../types/routing';

interface RouteTarget { name: string; lat: number; lng: number; }

interface Props {
  origin: LiveLocation | null;
  locationStatus: LocationStatus;
  target: RouteTarget | null;
  onTargetChange: (target: RouteTarget) => void;
  onEnableLocation: () => void;
  onClose: () => void;
  onRouteSelect: (suggestion: RouteSuggestion | null) => void;
  onBook: (destinationName: string) => void;
}

const ACCENT = '#00e5ff';

// Live re-routing — refetch only after the user has moved a meaningful
// distance, and never more often than this, so GPS jitter can't spam OSRM.
const REROUTE_DIST_M = 35;
const REROUTE_MIN_MS = 7000;

// ── Geo / formatting helpers ───────────────────────────────────────────────────

function distM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

const fmtCost = (eur: number) =>
  eur <= 0 ? 'Gratis' : `€ ${eur.toFixed(2).replace('.', ',')}`;

const fmtDist = (m: number) =>
  m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;

const fmtDur = (min: number) => `${Math.max(1, Math.round(min))} min`;

const fmtClock = (epoch: number) => {
  const d = new Date(epoch);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

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
    @keyframes cs-route-pulse { 0%,100% { opacity: 0.35; } 50% { opacity: 1; } }
    .cs-route-panel  { animation: cs-route-in 0.34s cubic-bezier(0.16,1,0.3,1) both; }
    .cs-route-card   { animation: cs-route-card-in 0.26s ease both; }
    .cs-route-recalc { animation: cs-route-pulse 1.1s ease-in-out infinite; }
    .cs-route-scroll::-webkit-scrollbar,
    .cs-route-results::-webkit-scrollbar { width: 6px; }
    .cs-route-scroll::-webkit-scrollbar-thumb,
    .cs-route-results::-webkit-scrollbar-thumb {
      background: rgba(255,255,255,0.14); border-radius: 3px;
    }
    .cs-route-result:hover { background: rgba(255,255,255,0.07) !important; }
    .cs-route-search-input::placeholder { color: rgba(255,255,255,0.34); }
  `;
  document.head.appendChild(s);
}

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
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
      <div style={{ width: 2, height: 12, marginLeft: 7, background: 'rgba(255,255,255,0.18)' }} />
      {row(<div style={{
        width: 11, height: 11, borderRadius: '50% 50% 50% 0',
        transform: 'rotate(-45deg)', background: '#ec4899', border: '2px solid #fff',
      }} />, destLabel)}
    </div>
  );
}

// ── Destination search field ────────────────────────────────────────────────────

function DestinationSearch({ onPick }: { onPick: (p: PlaceResult) => void }) {
  const { query, results, loading, search, clear } = useDestinationSearch();
  const [focused, setFocused] = useState(false);
  const showResults = focused && query.trim().length >= 2;

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 7,
        background: 'rgba(255,255,255,0.06)',
        border: `1px solid ${focused ? ACCENT + '88' : 'rgba(255,255,255,0.12)'}`,
        borderRadius: 10, padding: '0 10px', height: 38,
        transition: 'border-color 0.15s ease',
      }}>
        <span style={{ fontSize: 13, opacity: 0.6 }}>🔍</span>
        <input
          className="cs-route-search-input"
          value={query}
          placeholder="Cerca una destinazione…"
          onChange={(e) => search(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            flex: 1, minWidth: 0, height: '100%',
            background: 'transparent', border: 'none', outline: 'none',
            color: '#fff', fontSize: 12.5, fontWeight: 500,
          }}
        />
        {query.length > 0 && (
          <span
            onMouseDown={(e) => { e.preventDefault(); clear(); }}
            style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', cursor: 'pointer', padding: '0 2px' }}
          >×</span>
        )}
      </div>

      {showResults && (
        <div
          className="cs-route-results"
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0,
            zIndex: 20, maxHeight: 248, overflowY: 'auto',
            background: 'rgba(20,21,28,0.97)',
            backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(255,255,255,0.14)', borderRadius: 11,
            boxShadow: '0 18px 44px rgba(0,0,0,0.62)', padding: 4,
          }}
        >
          {loading && results.length === 0 && (
            <div style={{ padding: '12px 8px', fontSize: 11.5, color: 'rgba(255,255,255,0.45)', fontWeight: 600 }}>
              Ricerca…
            </div>
          )}
          {!loading && results.length === 0 && (
            <div style={{ padding: '12px 8px', fontSize: 11.5, color: 'rgba(255,255,255,0.45)', fontWeight: 600 }}>
              Nessun luogo trovato
            </div>
          )}
          {results.map((r, i) => (
            <div
              key={`${r.category}-${r.name}-${i}`}
              className="cs-route-result"
              onMouseDown={(e) => { e.preventDefault(); onPick(r); clear(); setFocused(false); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 9,
                padding: '8px 8px', borderRadius: 8, cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: 15, flexShrink: 0 }}>{PLACE_ICON[r.category]}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12, fontWeight: 600, color: '#fff',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>{r.name}</div>
                <div style={{
                  fontSize: 10, color: 'rgba(255,255,255,0.42)', marginTop: 1,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>{r.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Live navigation card ────────────────────────────────────────────────────────

function NavCard({ route, target, arrivalEpoch, nowTs, progress, recalculating }: {
  route: RouteSuggestion;
  target: RouteTarget;
  arrivalEpoch: number | null;
  nowTs: number;
  progress: number;
  recalculating: boolean;
}) {
  const remainingMin = arrivalEpoch
    ? Math.max(0, Math.round((arrivalEpoch - nowTs) / 60000))
    : Math.round(route.total_duration_min);
  const nextLeg = route.legs[0];
  const pct = Math.round(progress * 100);

  return (
    <div className="cs-route-card" style={{ padding: '4px 2px' }}>
      {/* Mode + recalculating indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <div style={{
          width: 34, height: 34, borderRadius: 9, flexShrink: 0,
          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17,
        }}>
          {route.icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{route.label}</div>
          <div style={{ fontSize: 10.5, color: '#34d399', fontWeight: 700, marginTop: 1 }}>
            ● In viaggio
          </div>
        </div>
        {recalculating && (
          <span className="cs-route-recalc" style={{
            fontSize: 9.5, fontWeight: 800, letterSpacing: '0.04em', color: ACCENT,
          }}>RICALCOLO…</span>
        )}
      </div>

      {/* ETA */}
      <div style={{ textAlign: 'center', padding: '16px 0 13px' }}>
        <div style={{
          fontSize: 10, fontWeight: 800, letterSpacing: '0.1em',
          color: 'rgba(255,255,255,0.42)',
        }}>ARRIVO STIMATO</div>
        <div style={{ fontSize: 36, fontWeight: 800, color: '#fff', lineHeight: 1.05, marginTop: 4 }}>
          {arrivalEpoch ? fmtClock(arrivalEpoch) : '—:—'}
        </div>
        <div style={{ fontSize: 13, color: ACCENT, fontWeight: 700, marginTop: 3 }}>
          tra {remainingMin} min · {fmtDist(route.total_distance_m)}
        </div>
      </div>

      {/* Progress */}
      <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${pct}%`,
          background: `linear-gradient(90deg, ${ACCENT}, #0891b2)`,
          borderRadius: 4, transition: 'width 0.6s ease',
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
        <span style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.4)', fontWeight: 700 }}>
          {pct}% completato
        </span>
        <span style={{
          fontSize: 9.5, color: 'rgba(255,255,255,0.4)', fontWeight: 700,
          maxWidth: 170, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>→ {target.name}</span>
      </div>

      {/* Next leg */}
      {nextLeg && (
        <div style={{
          marginTop: 13, display: 'flex', alignItems: 'center', gap: 9,
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 10, padding: '9px 11px',
        }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>{MODE_META[nextLeg.mode].icon}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 8.5, fontWeight: 800, letterSpacing: '0.06em',
              color: 'rgba(255,255,255,0.4)',
            }}>PROSSIMO PASSO</div>
            <div style={{
              fontSize: 11.5, fontWeight: 600, color: '#fff', marginTop: 1,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {MODE_META[nextLeg.mode].label} fino a {nextLeg.to.name}
            </div>
          </div>
          <span style={{ fontSize: 11, fontWeight: 800, color: 'rgba(255,255,255,0.65)', flexShrink: 0 }}>
            {Math.max(1, Math.round(nextLeg.duration_min))}′
          </span>
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function RoutingPanel({
  origin, locationStatus, target, onTargetChange,
  onEnableLocation, onClose, onRouteSelect, onBook,
}: Props) {
  const { status, response, error, fetchRoutes, reset } = useRouting();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [liveNav, setLiveNav] = useState(false);
  const [arrivalEpoch, setArrivalEpoch] = useState<number | null>(null);
  const [nowTs, setNowTs] = useState(() => Date.now());

  const selected = response?.suggestions.find((s) => s.id === selectedId) ?? null;

  // Records the origin/destination of the last fetch, to decide when a live
  // re-route is warranted; and the route distance when navigation started.
  const lastFetch = useRef<{ destKey: string; lat: number; lng: number; t: number } | null>(null);
  const tripStartDist = useRef<number | null>(null);

  useEffect(() => { injectStyles(); }, []);

  // Fetch on a new destination, or — while navigating — once the user has
  // moved far enough from the position the current route was built from.
  useEffect(() => {
    if (!target) {
      lastFetch.current = null;
      setSelectedId(null);
      reset();
      return;
    }
    if (!origin) return;

    const destKey = `${target.lat.toFixed(5)},${target.lng.toFixed(5)}`;
    const last = lastFetch.current;
    const destChanged = !last || last.destKey !== destKey;

    let shouldFetch = destChanged;
    if (!destChanged && liveNav && last) {
      const moved = distM(origin, { lat: last.lat, lng: last.lng });
      if (moved >= REROUTE_DIST_M && Date.now() - last.t >= REROUTE_MIN_MS) {
        shouldFetch = true;
      }
    }
    if (!shouldFetch) return;

    if (destChanged) setSelectedId(null);
    lastFetch.current = { destKey, lat: origin.lat, lng: origin.lng, t: Date.now() };
    fetchRoutes({ lat: origin.lat, lng: origin.lng }, target);
  }, [target, origin, liveNav, fetchRoutes, reset]);

  // When results arrive, keep the chosen modality if it still exists
  // (so a live re-route doesn't snap the user back to "recommended").
  useEffect(() => {
    if (status === 'ready' && response) {
      setSelectedId((prev) =>
        prev && response.suggestions.some((s) => s.id === prev)
          ? prev
          : (response.suggestions.find((s) => s.recommended)
             ?? response.suggestions[0])?.id ?? null,
      );
    }
  }, [status, response]);

  // Surface the selected itinerary to the map.
  useEffect(() => {
    onRouteSelect(selected);
  }, [selected, onRouteSelect]);

  // Refresh the arrival estimate on every (re-)route while navigating.
  useEffect(() => {
    if (liveNav && selected) {
      setArrivalEpoch(Date.now() + selected.total_duration_min * 60000);
    }
  }, [liveNav, selected]);

  // Tick the clock so the countdown stays current between re-routes.
  useEffect(() => {
    if (!liveNav) return;
    const id = setInterval(() => setNowTs(Date.now()), 15000);
    return () => clearInterval(id);
  }, [liveNav]);

  // Clear the drawn route when the panel goes away.
  useEffect(() => () => { onRouteSelect(null); reset(); }, [onRouteSelect, reset]);

  const startNav = useCallback(() => {
    if (!selected) return;
    tripStartDist.current = selected.total_distance_m;
    setArrivalEpoch(Date.now() + selected.total_duration_min * 60000);
    setNowTs(Date.now());
    setLiveNav(true);
  }, [selected]);

  const endNav = useCallback(() => {
    setLiveNav(false);
    tripStartDist.current = null;
    setArrivalEpoch(null);
  }, []);

  const noLocation = locationStatus === 'idle' || locationStatus === 'error';
  const progress = (tripStartDist.current && selected)
    ? Math.min(1, Math.max(0, 1 - selected.total_distance_m / tripStartDist.current))
    : 0;

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
        }}>{liveNav ? 'NAVIGAZIONE' : 'INDICAZIONI'}</span>
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

      {/* Search + itinerary (hidden during live navigation) */}
      {!liveNav && (
        <div style={{
          padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.07)',
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          <DestinationSearch onPick={(p) => onTargetChange({ name: p.name, lat: p.lat, lng: p.lng })} />
          {target && (
            <div>
              <ItineraryHeader
                originLabel={origin ? 'La tua posizione' : 'Posizione non attiva'}
                destLabel={target.name}
              />
              {response && (
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 9, fontWeight: 600 }}>
                  {fmtDist(response.straight_line_m)} in linea d'aria · {response.suggestions.length} opzioni
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Body */}
      <div
        className="cs-route-scroll"
        style={{ overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        {liveNav && selected && target ? (
          <NavCard
            route={selected}
            target={target}
            arrivalEpoch={arrivalEpoch}
            nowTs={nowTs}
            progress={progress}
            recalculating={status === 'loading'}
          />
        ) : (
          <>
            {!target && (
              <div style={{ textAlign: 'center', padding: '18px 8px' }}>
                <div style={{ fontSize: 26, marginBottom: 8 }}>🗺️</div>
                <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.6)', fontWeight: 600, lineHeight: 1.5 }}>
                  Cerca una destinazione qui sopra, oppure tocca un punto sulla mappa per ottenere le indicazioni.
                </div>
              </div>
            )}

            {target && noLocation && (
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

            {target && !noLocation && locationStatus === 'locating' && !response && (
              <div style={{ textAlign: 'center', padding: '20px 4px', color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: 600 }}>
                <div style={{
                  width: 22, height: 22, margin: '0 auto 10px', borderRadius: '50%',
                  border: '2px solid rgba(255,255,255,0.18)', borderTopColor: ACCENT,
                  animation: 'cs-route-spin 0.8s linear infinite',
                }} />
                Individuazione della posizione…
              </div>
            )}

            {target && status === 'loading' && (
              <div style={{ textAlign: 'center', padding: '20px 4px', color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: 600 }}>
                <div style={{
                  width: 22, height: 22, margin: '0 auto 10px', borderRadius: '50%',
                  border: '2px solid rgba(255,255,255,0.18)', borderTopColor: ACCENT,
                  animation: 'cs-route-spin 0.8s linear infinite',
                }} />
                Calcolo dei percorsi…
              </div>
            )}

            {target && status === 'error' && (
              <div style={{ textAlign: 'center', padding: '16px 4px', color: '#f87171', fontSize: 12, fontWeight: 600 }}>
                {error ?? 'Impossibile calcolare il percorso'}
              </div>
            )}

            {target && status === 'ready' && response && response.suggestions.map((s, i) => (
              <SuggestionCard
                key={s.id}
                s={s}
                index={i}
                selected={s.id === selectedId}
                onSelect={() => setSelectedId(s.id)}
              />
            ))}
          </>
        )}
      </div>

      {/* Footer */}
      {liveNav && target ? (
        <div style={{
          display: 'flex', gap: 8, padding: '11px 14px',
          borderTop: '1px solid rgba(255,255,255,0.08)',
        }}>
          <div
            onClick={() => onBook(target.name)}
            style={{
              flex: 1, background: ACCENT + '1c', border: `1px solid ${ACCENT}77`,
              borderRadius: 10, padding: '10px 0', textAlign: 'center', cursor: 'pointer',
              fontSize: 12.5, fontWeight: 800, color: ACCENT,
            }}
          >
            Prenota
          </div>
          <div
            onClick={endNav}
            style={{
              flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)',
              borderRadius: 10, padding: '10px 0', textAlign: 'center', cursor: 'pointer',
              fontSize: 12.5, fontWeight: 800, color: 'rgba(255,255,255,0.75)',
            }}
          >
            Termina
          </div>
        </div>
      ) : selected && target ? (
        <div style={{ padding: '11px 14px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <div
            onClick={startNav}
            style={{
              background: `linear-gradient(135deg, ${ACCENT}, #0891b2)`,
              borderRadius: 10, padding: '11px 0', textAlign: 'center', cursor: 'pointer',
              fontSize: 13, fontWeight: 800, color: '#04222a',
              boxShadow: `0 6px 20px ${ACCENT}3d`,
            }}
          >
            ▶ Avvia navigazione · {selected.label}
          </div>
        </div>
      ) : null}
    </div>
  );
}
