import React, { useState, useEffect, useCallback, useRef, CSSProperties } from 'react';
import { useBooking } from '../hooks/useBooking';
import { TripSearchResponse, TripBookResponse } from '../types/booking';

// ── Global CSS injection (mirrors MapView.web.tsx pattern) ───────────────────

function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById('cs-booking-styles')) return;
  const s = document.createElement('style');
  s.id = 'cs-booking-styles';
  s.textContent = `
    @keyframes cs-slide-up {
      from { transform: translateY(110%); opacity: 0; }
      to   { transform: translateY(0);    opacity: 1; }
    }
    @keyframes cs-fade-in {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes cs-spin { to { transform: rotate(360deg); } }
    @keyframes cs-shimmer {
      0%   { background-position: -500px 0; }
      100% { background-position:  500px 0; }
    }
    @keyframes cs-pulse-glow {
      0%, 100% { box-shadow: 0 4px 20px rgba(0,229,255,0.35); }
      50%       { box-shadow: 0 4px 32px rgba(0,229,255,0.65); }
    }
    .cs-slide-up  { animation: cs-slide-up 0.38s cubic-bezier(0.16,1,0.3,1) both; }
    .cs-fade-in   { animation: cs-fade-in  0.24s ease both; }
    .cs-spinner   { animation: cs-spin 0.7s linear infinite; }
    .cs-skeleton  {
      background: linear-gradient(
        90deg,
        rgba(255,255,255,0.04) 25%,
        rgba(255,255,255,0.10) 50%,
        rgba(255,255,255,0.04) 75%
      );
      background-size: 500px 100%;
      animation: cs-shimmer 1.5s infinite;
      border-radius: 8px;
    }
    .cs-btn-cta {
      transition: transform 0.12s ease, box-shadow 0.12s ease, background 0.12s ease;
      animation: cs-pulse-glow 2.8s ease-in-out infinite;
    }
    .cs-btn-cta:hover  { transform: translateY(-2px) !important; background: #00ccee !important; }
    .cs-btn-cta:active { transform: translateY(0)    !important; }
    .cs-btn-ghost { transition: background 0.12s ease; }
    .cs-btn-ghost:hover { background: rgba(255,255,255,0.1) !important; }
    .cs-search-input:focus { outline: none; }
    .cs-suggestion:hover { background: rgba(255,255,255,0.05) !important; }
    .cs-icon-btn:hover { background: rgba(255,255,255,0.1) !important; }
    .cs-capacity-bar { transition: width 0.7s cubic-bezier(0.16,1,0.3,1); }
  `;
  document.head.appendChild(s);
}

// ── Design tokens (matches constants/colors.ts) ───────────────────────────────

const C = {
  bg:          '#0d0d0d',
  surface:     '#111111',
  surface2:    '#1a1a1a',
  border:      'rgba(255,255,255,0.08)',
  text:        '#ffffff',
  muted:       'rgba(255,255,255,0.45)',
  faint:       'rgba(255,255,255,0.22)',
  cyan:        '#00e5ff',
  green:       '#34d399',
  yellow:      '#fbbf24',
  purple:      '#a78bfa',
  orange:      '#f97316',
  red:         '#ef4444',
} as const;

// ── Inline SVG micro-icons (avoids any icon-library dependency) ───────────────

const Ico = {
  Search: () => (
    <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
    </svg>
  ),
  Train: () => (
    <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <rect x="4" y="3" width="16" height="16" rx="2"/><path d="M4 11h16M12 3v8M8 19l4-4 4 4"/>
    </svg>
  ),
  Parking: () => (
    <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 17V7h4a3 3 0 0 1 0 6H9"/>
    </svg>
  ),
  Bike: () => (
    <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/>
      <path d="M15 6a1 1 0 0 0-1 1v5H9L7 6"/><path d="M5 6h5l.5 1"/>
    </svg>
  ),
  MapPin: () => (
    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>
    </svg>
  ),
  X: () => (
    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24">
      <path d="M18 6 6 18M6 6l12 12"/>
    </svg>
  ),
  Check: () => (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M20 6 9 17l-5-5"/>
    </svg>
  ),
  ArrowRight: () => (
    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M5 12h14M12 5l7 7-7 7"/>
    </svg>
  ),
  Lightning: () => (
    <svg width="13" height="13" fill="currentColor" viewBox="0 0 24 24">
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>
    </svg>
  ),
};

// ── Mock QR code (deterministic SVG grid from payload string) ─────────────────

function MockQR({ payload }: { payload: string }) {
  const SIZE = 17;
  const CELL = 8;

  // LCG seeded from payload
  let seed = 0;
  for (let i = 0; i < payload.length; i++) {
    seed = (((seed << 5) - seed) + payload.charCodeAt(i)) | 0;
  }
  function rand() {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 0xffffffff;
  }

  const cells: boolean[][] = Array.from({ length: SIZE }, () =>
    Array.from({ length: SIZE }, () => rand() > 0.42)
  );

  // Stamp three 7×7 finder patterns (corners)
  function finder(r0: number, c0: number) {
    for (let dr = 0; dr < 7; dr++) {
      for (let dc = 0; dc < 7; dc++) {
        const r = r0 + dr, c = c0 + dc;
        if (r >= SIZE || c >= SIZE) continue;
        const outer  = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inner  = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        cells[r][c]  = outer || inner;
      }
    }
  }
  finder(0, 0);
  finder(0, SIZE - 7);
  finder(SIZE - 7, 0);

  const totalPx = SIZE * CELL;
  return (
    <div style={{ background: '#fff', padding: 8, borderRadius: 10, display: 'inline-block', flexShrink: 0 }}>
      <svg width={totalPx} height={totalPx} viewBox={`0 0 ${totalPx} ${totalPx}`}>
        {cells.map((row, r) =>
          row.map((on, c) =>
            on ? <rect key={`${r}-${c}`} x={c * CELL} y={r * CELL} width={CELL} height={CELL} fill="#000" /> : null
          )
        )}
      </svg>
    </div>
  );
}

// ── Capacity bar ──────────────────────────────────────────────────────────────

function CapacityBar({ free, total, color }: { free: number; total: number; color: string }) {
  const pct = Math.round(((total - free) / total) * 100);
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Disponibilità</span>
        <span style={{ fontSize: 12, fontWeight: 700, color }}>
          {free}/{total} liberi
        </span>
      </div>
      <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
        <div
          className="cs-capacity-bar"
          style={{ height: '100%', width: `${100 - pct}%`, background: color, borderRadius: 3 }}
        />
      </div>
    </div>
  );
}

// ── Skeleton loading cards ────────────────────────────────────────────────────

function SkeletonCards() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {[80, 110, 70].map((w, i) => (
        <div key={i} style={{ ...CARD, gap: 12 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div className="cs-skeleton" style={{ width: 36, height: 36, borderRadius: 10 }} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="cs-skeleton" style={{ height: 12, width: `${w}%` }} />
              <div className="cs-skeleton" style={{ height: 9, width: '45%' }} />
            </div>
          </div>
          <div className="cs-skeleton" style={{ height: 5, width: '100%' }} />
        </div>
      ))}
    </div>
  );
}

// ── Spinner ───────────────────────────────────────────────────────────────────

function Spinner({ size = 24, color = C.cyan }: { size?: number; color?: string }) {
  return (
    <div
      className="cs-spinner"
      style={{
        width: size, height: size,
        border: `2.5px solid rgba(255,255,255,0.1)`,
        borderTopColor: color,
        borderRadius: '50%',
        flexShrink: 0,
      }}
    />
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '--:--';
  }
}

// ── Shared style objects ──────────────────────────────────────────────────────

const CARD: CSSProperties = {
  background: C.surface2,
  borderRadius: 16,
  padding: '14px 16px',
  border: `1px solid rgba(255,255,255,0.07)`,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const ICON_BADGE = (color: string): CSSProperties => ({
  width: 36, height: 36, borderRadius: 10, flexShrink: 0,
  background: color + '1a',
  border: `1px solid ${color}44`,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  color,
});

// ── Option view ───────────────────────────────────────────────────────────────

function OptionView({
  option,
  booking,
  onBook,
  error,
}: {
  option: TripSearchResponse;
  booking: boolean;
  onBook: () => void;
  error: string | null;
}) {
  if (booking) return <div className="cs-fade-in"><SkeletonCards /></div>;

  return (
    <div className="cs-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Train card */}
      <div style={CARD}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={ICON_BADGE(C.cyan)}><Ico.Train /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Treno Regionale</div>
            <div style={{ fontSize: 11, color: C.cyan, fontWeight: 600, marginTop: 2 }}>{option.train.track}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.text, lineHeight: 1 }}>{fmtTime(option.train.departure_time)}</div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>Binario {option.train.platform}</div>
          </div>
        </div>
        <div style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />
        <CapacityBar
          free={option.train.available_seats}
          total={option.train.total_seats}
          color={C.cyan}
        />
      </div>

      {/* Parking card */}
      <div style={CARD}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={ICON_BADGE(C.green)}><Ico.Parking /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{option.parking.zone}</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{option.parking.description}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: C.muted, fontSize: 11 }}>
          <Ico.MapPin /><span>{option.parking.distance_meters}m dalla stazione</span>
        </div>
        <CapacityBar
          free={option.parking.free_spots}
          total={option.parking.total_spots}
          color={C.green}
        />
      </div>

      {/* Bike sharing card */}
      <div style={CARD}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={ICON_BADGE(C.purple)}><Ico.Bike /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{option.bike_sharing.station_name}</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
              {option.bike_sharing.available_bikes} bici · {option.bike_sharing.available_docks} dock liberi
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: C.muted, fontSize: 11 }}>
          <Ico.MapPin /><span>{option.bike_sharing.distance_meters}m dalla stazione</span>
        </div>
      </div>

      {/* Price row */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', padding: '2px 2px' }}>
        <div>
          <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Tariffa integrata</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: C.text, lineHeight: 1.1 }}>
            €&thinsp;{option.price_eur.toFixed(2)}
          </div>
        </div>
        <div style={{ fontSize: 10, color: C.muted, textAlign: 'right', maxWidth: 130, lineHeight: 1.5 }}>
          Opzione valida fino alle<br />{fmtTime(option.expires_at)}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          background: C.red + '18', border: `1px solid ${C.red}44`,
          borderRadius: 10, padding: '10px 14px',
          fontSize: 12, color: C.red, fontWeight: 500,
        }}>
          {error}
        </div>
      )}

      {/* CTA */}
      <button
        className="cs-btn-cta"
        onClick={onBook}
        style={{
          width: '100%', padding: '16px',
          background: C.cyan, color: '#000',
          border: 'none', borderRadius: 16,
          fontSize: 15, fontWeight: 800,
          cursor: 'pointer', fontFamily: 'inherit',
          letterSpacing: '0.02em',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}
      >
        <Ico.Lightning /> Prenota e Sincronizza <Ico.ArrowRight />
      </button>

      <p style={{ margin: 0, fontSize: 10, color: C.faint, textAlign: 'center', lineHeight: 1.6 }}>
        Prenotazione istantanea · Cancellazione gratuita entro 15 min
      </p>
    </div>
  );
}

// ── Boarding pass view ────────────────────────────────────────────────────────

function InfoRow({ label, value, color, large }: { label: string; value: string; color: string; large?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: C.faint, textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: large ? 20 : 13, fontWeight: large ? 800 : 600, color, lineHeight: 1.2 }}>{value}</div>
    </div>
  );
}

function BoardingPassView({ confirmation }: { confirmation: TripBookResponse }) {
  const bp = confirmation.boarding_pass;

  return (
    <div className="cs-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Pass card */}
      <div style={{
        borderRadius: 20, overflow: 'hidden',
        border: `1px solid rgba(0,229,255,0.2)`,
        background: 'linear-gradient(140deg, #0f1628 0%, #1a1040 100%)',
        boxShadow: '0 12px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,229,255,0.08)',
      }}>

        {/* Header strip */}
        <div style={{
          background: 'rgba(0,229,255,0.10)',
          borderBottom: '1px dashed rgba(255,255,255,0.10)',
          padding: '14px 18px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 9, color: C.cyan, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              CommuteSync · Boarding Pass
            </div>
            <div style={{ fontSize: 17, fontWeight: 800, color: C.text, marginTop: 3 }}>
              {bp.origin} → {bp.destination.split(' ').slice(-1)[0]}
            </div>
          </div>
          <div style={{
            background: C.green + '22', border: `1px solid ${C.green}55`,
            borderRadius: 8, padding: '5px 11px',
            fontSize: 9, fontWeight: 800, color: C.green, letterSpacing: '0.06em',
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <Ico.Check /> CONFERMATO
          </div>
        </div>

        {/* QR + details row */}
        <div style={{ padding: '16px 18px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <MockQR payload={bp.qr_payload} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 11 }}>
            <InfoRow label="Treno"    value={bp.train_code}         color={C.cyan} />
            <InfoRow label="Partenza" value={fmtTime(bp.departure_time)} color={C.text} large />
            <div style={{ display: 'flex', gap: 18 }}>
              <InfoRow label="Binario" value={String(bp.platform)} color={C.yellow} />
              <InfoRow label="Posto"   value={bp.seat}             color={C.purple} />
            </div>
            <InfoRow label="Tipo"    value={bp.validity}           color={C.muted} />
          </div>
        </div>

        {/* Footer */}
        <div style={{
          borderTop: '1px dashed rgba(255,255,255,0.08)',
          padding: '10px 18px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: 9, color: C.faint }}>ID prenotazione</span>
          <span style={{ fontSize: 11, fontWeight: 800, color: C.muted, letterSpacing: '0.1em' }}>{bp.booking_id}</span>
        </div>
      </div>

      {/* Secondary CTA */}
      <button
        className="cs-btn-ghost"
        style={{
          width: '100%', padding: '13px',
          background: 'rgba(255,255,255,0.05)',
          color: C.text, border: `1px solid ${C.border}`,
          borderRadius: 14, fontSize: 13, fontWeight: 700,
          cursor: 'pointer', fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}
      >
        <Ico.MapPin /> Naviga alla stazione <Ico.ArrowRight />
      </button>

      <p style={{ margin: 0, fontSize: 10, color: C.faint, textAlign: 'center' }}>
        Confermato alle {fmtTime(confirmation.confirmed_at)}
      </p>
    </div>
  );
}

// ── Destination search bar (idle state) ───────────────────────────────────────

const SUGGESTIONS = ['Stazione FS Rovereto', 'Stazione FS Trento'];

function SearchBar({ onSearch }: { onSearch: (dest: string) => void }) {
  const [query, setQuery]   = useState('');
  const [open, setOpen]     = useState(false);
  const inputRef            = useRef<HTMLInputElement>(null);

  const submit = useCallback((dest: string) => {
    if (!dest.trim()) return;
    setQuery(dest);
    setOpen(false);
    onSearch(dest);
  }, [onSearch]);

  return (
    <div className="cs-fade-in" style={{
      position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)',
      width: 'min(440px, calc(100vw - 48px))', zIndex: 1000,
    }}>
      <div style={{
        background: C.surface,
        borderRadius: open ? '18px 18px 16px 16px' : 20,
        border: `1px solid ${C.border}`,
        boxShadow: '0 20px 60px rgba(0,0,0,0.7), 0 2px 8px rgba(0,0,0,0.4)',
        overflow: 'hidden',
      }}>
        {/* Input row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
          <div style={{
            width: 34, height: 34, borderRadius: 11, flexShrink: 0,
            background: C.cyan + '18', border: `1px solid ${C.cyan}30`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.cyan,
          }}>
            <Ico.Search />
          </div>
          <input
            ref={inputRef}
            className="cs-search-input"
            style={{
              flex: 1, background: 'transparent', border: 'none',
              color: C.text, fontSize: 15, fontWeight: 500, fontFamily: 'inherit',
            }}
            placeholder="Dove vuoi andare?"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 160)}
            onKeyDown={(e) => e.key === 'Enter' && submit(query)}
          />
          <button
            onClick={() => submit(query)}
            style={{
              padding: '7px 14px', background: C.cyan, color: '#000',
              border: 'none', borderRadius: 10, fontSize: 12, fontWeight: 800,
              cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.02em',
              flexShrink: 0,
            }}
          >
            Cerca →
          </button>
        </div>

        {/* Suggestions */}
        {open && (
          <div style={{ borderTop: `1px solid ${C.border}`, paddingBottom: 6 }}>
            {SUGGESTIONS.filter((s) =>
              !query || s.toLowerCase().includes(query.toLowerCase())
            ).map((s) => (
              <button
                key={s}
                className="cs-suggestion"
                onMouseDown={() => submit(s)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', padding: '10px 14px',
                  background: 'transparent', border: 'none',
                  color: C.text, fontSize: 13, fontWeight: 500,
                  fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left',
                }}
              >
                <span style={{ color: C.muted }}><Ico.MapPin /></span>
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sheet panel (expanded states) ─────────────────────────────────────────────

const SHEET_HEIGHT: Record<string, string> = {
  searching: '200px',
  option:    'min(72vh, 620px)',
  booking:   'min(72vh, 620px)',
  confirmed: 'min(72vh, 600px)',
};

function SheetPanel({
  state,
  query,
  onBook,
  onDismiss,
}: {
  state: ReturnType<typeof useBooking>['state'];
  query: string;
  onBook: () => void;
  onDismiss: () => void;
}) {
  const { phase, option, confirmation, error } = state;
  const height = SHEET_HEIGHT[phase] ?? '0';
  const confirmed = phase === 'confirmed';

  const destLabel =
    option?.destination ??
    confirmation?.boarding_pass.destination ??
    query;

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0,
      zIndex: 1000,
      display: 'flex', justifyContent: 'center',
      pointerEvents: 'none',
    }}>
      <div
        className="cs-slide-up"
        style={{
          width: 'min(500px, 100%)',
          background: C.surface,
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          borderTop: `1px solid ${C.border}`,
          borderLeft: `1px solid ${C.border}`,
          borderRight: `1px solid ${C.border}`,
          boxShadow: '0 -20px 60px rgba(0,0,0,0.75)',
          height,
          display: 'flex', flexDirection: 'column',
          pointerEvents: 'all',
          transition: 'height 0.35s cubic-bezier(0.16,1,0.3,1)',
          overflow: 'hidden',
        }}
      >
        {/* Handle + header */}
        <div style={{
          flexShrink: 0,
          padding: '12px 18px 14px',
          borderBottom: `1px solid ${C.border}`,
        }}>
          <div style={{
            width: 36, height: 4, borderRadius: 2,
            background: 'rgba(255,255,255,0.15)',
            margin: '0 auto 12px',
          }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              className="cs-icon-btn"
              onClick={onDismiss}
              style={{
                width: 32, height: 32, borderRadius: 10, flexShrink: 0,
                background: 'rgba(255,255,255,0.06)',
                border: `1px solid ${C.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: C.muted,
              }}
            >
              <Ico.X />
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                {confirmed ? 'Prenotazione confermata' : 'Destinazione'}
              </div>
              <div style={{
                fontSize: 15, fontWeight: 700, color: C.text,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {phase === 'searching' ? 'Ricerca in corso…' : destLabel}
              </div>
            </div>
            {confirmed && (
              <div style={{
                width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                background: C.green + '20', border: `1px solid ${C.green}44`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.green,
              }}>
                <Ico.Check />
              </div>
            )}
          </div>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px 28px' }}>
          {phase === 'searching' && (
            <div className="cs-fade-in" style={{
              height: '100%', display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 12,
            }}>
              <Spinner size={28} />
              <span style={{ fontSize: 14, color: C.muted, fontWeight: 500 }}>Ricerca opzioni disponibili…</span>
            </div>
          )}

          {(phase === 'option' || phase === 'booking') && option && (
            <OptionView
              option={option}
              booking={phase === 'booking'}
              onBook={onBook}
              error={error}
            />
          )}

          {phase === 'confirmed' && confirmation && (
            <BoardingPassView confirmation={confirmation} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Root export ───────────────────────────────────────────────────────────────

interface Props {
  onRouteReady?: (waypoints: [number, number][], dest: [number, number]) => void;
}

export default function BookingSheet({ onRouteReady }: Props) {
  const { state, search, book, dismiss } = useBooking();
  const [query, setQuery] = useState('');

  useEffect(() => { injectStyles(); }, []);

  // Notify map when boarding pass is issued
  useEffect(() => {
    if (state.phase === 'confirmed' && state.confirmation && onRouteReady) {
      const bp = state.confirmation.boarding_pass;
      onRouteReady(
        bp.route_waypoints as [number, number][],
        bp.destination_coords as [number, number]
      );
    }
  }, [state.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = useCallback((dest: string) => {
    setQuery(dest);
    search(dest);
  }, [search]);

  const handleBook = useCallback(() => {
    if (state.option) book(state.option.option_id);
  }, [state.option, book]);

  if (state.phase === 'idle') {
    return <SearchBar onSearch={handleSearch} />;
  }

  return (
    <SheetPanel
      state={state}
      query={query}
      onBook={handleBook}
      onDismiss={dismiss}
    />
  );
}
