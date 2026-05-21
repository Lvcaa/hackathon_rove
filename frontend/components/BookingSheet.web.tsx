import React, { useState, useEffect, useCallback, useRef, CSSProperties } from 'react';
import { useBooking } from '../hooks/useBooking';
import AIPlannerPanel from './AIPlannerPanel';
import { RouteSuggestion } from '../types/routing';
import {
  ModalityOption, TrainModality, ParkingModality,
  TaxiModality, BikeSharingModality, TripBookResponse,
} from '../types/booking';

// ── CSS injection ─────────────────────────────────────────────────────────────

function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById('cs-booking-styles')) return;
  const s = document.createElement('style');
  s.id = 'cs-booking-styles';
  s.textContent = `
    /* Pane grows downward out of the search bar. */
    @keyframes cs-pane-in {
      from { opacity: 0; transform: translateY(-10px) scale(0.95); }
      to   { opacity: 1; transform: translateY(0)     scale(1); }
    }
    @keyframes cs-pane-out {
      from { opacity: 1; transform: translateY(0)     scale(1); }
      to   { opacity: 0; transform: translateY(-10px) scale(0.95); }
    }
    @keyframes cs-fade-in {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes cs-spin { to { transform: rotate(360deg); } }
    @keyframes cs-shimmer {
      0%   { background-position: -500px 0; }
      100% { background-position:  500px 0; }
    }
    @keyframes cs-pulse-border {
      0%, 100% { border-color: rgba(0,229,255,0.25); }
      50%       { border-color: rgba(0,229,255,0.55); }
    }

    .cs-pane-in {
      animation: cs-pane-in 0.36s cubic-bezier(0.16,1,0.3,1) both;
      transform-origin: top center;
    }
    .cs-pane-out {
      animation: cs-pane-out 0.28s cubic-bezier(0.4,0,1,1) both;
      transform-origin: top center;
      pointer-events: none;
    }
    .cs-clear-btn { transition: opacity 0.15s ease, transform 0.15s ease; }
    .cs-clear-btn:hover { opacity: 1 !important; transform: scale(1.1); }
    .cs-fade-in  { animation: cs-fade-in  0.22s ease both; }
    .cs-spinner  { animation: cs-spin 0.7s linear infinite; }

    .cs-skeleton {
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

    /* Modality card hover/active */
    .cs-modality-card {
      transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
      cursor: default;
    }
    .cs-modality-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 32px rgba(0,0,0,0.45) !important;
    }
    .cs-modality-card.cs-booking {
      animation: cs-pulse-border 1.6s ease-in-out infinite;
    }

    /* Prenota button */
    .cs-btn-book {
      transition: transform 0.12s ease, opacity 0.12s ease, background 0.12s ease;
    }
    .cs-btn-book:hover:not(:disabled) { transform: translateY(-1px); opacity: 0.92; }
    .cs-btn-book:active:not(:disabled) { transform: translateY(0); }
    .cs-btn-book:disabled { opacity: 0.5; cursor: not-allowed; }

    .cs-btn-ghost { transition: background 0.12s ease; }
    .cs-btn-ghost:hover { background: rgba(255,255,255,0.1) !important; }

    .cs-search-input:focus { outline: none; }
    .cs-icon-btn:hover { background: rgba(255,255,255,0.1) !important; }

    .cs-cap-bar { transition: width 0.7s cubic-bezier(0.16,1,0.3,1); }

    /* ── Destination search bar ───────────────────────────────────────── */
    .cs-searchbar {
      transition: transform 0.22s cubic-bezier(0.16,1,0.3,1),
                  box-shadow 0.22s ease, border-color 0.22s ease;
    }
    .cs-searchbar:hover {
      transform: translateY(-1px);
      border-color: rgba(0,229,255,0.32) !important;
      box-shadow: 0 0 0 1px rgba(0,229,255,0.14),
                  0 10px 38px rgba(0,0,0,0.58),
                  inset 0 1px 0 rgba(255,255,255,0.10) !important;
    }
    .cs-searchbar:focus-within {
      border-color: rgba(0,229,255,0.55) !important;
      box-shadow: 0 8px 32px rgba(0,0,0,0.55),
                  0 0 0 3px rgba(0,229,255,0.10),
                  inset 0 1px 0 rgba(255,255,255,0.12) !important;
    }
    /* Icon badge picks up cyan tint while the field is focused */
    .cs-search-badge {
      transition: background 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
    }
    .cs-searchbar:focus-within .cs-search-badge {
      background: rgba(0,229,255,0.12) !important;
      border-color: rgba(0,229,255,0.35) !important;
      transform: scale(1.06);
    }
    .cs-search-input::placeholder { color: rgba(255,255,255,0.38); font-weight: 400; }
    /* Submit button: lift on hover, press on click */
    .cs-search-btn {
      transition: transform 0.12s ease, box-shadow 0.16s ease;
    }
    .cs-search-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 22px rgba(0,229,255,0.35);
    }
    .cs-search-btn:active { transform: translateY(0) scale(0.96); }
    /* Suggestion rows: subtle wash + nudge on hover */
    .cs-suggestion {
      transition: background 0.13s ease, padding-left 0.13s ease;
    }
    .cs-suggestion:hover {
      background: rgba(255,255,255,0.06) !important;
      padding-left: 20px !important;
    }

    /* ── Squircle hover glow ─────────────────────────────────────────────── */
    /* Base = exit transition: glow lingers as it fades out */
    .cs-ai-squircle {
      transition: box-shadow 0.55s ease, border-color 0.45s ease,
                  transform 0.35s ease, background 0.45s ease;
    }
    /* :hover = enter transition: glow snaps on immediately */
    .cs-ai-squircle:hover {
      transition: box-shadow 0.16s ease, border-color 0.12s ease,
                  transform 0.22s cubic-bezier(0.34,1.56,0.64,1), background 0.16s ease;
      background: rgba(0,229,255,0.05);
      border-color: rgba(0,229,255,0.65) !important;
      box-shadow:
        0 0 0 1px rgba(0,229,255,0.55),
        0 0 16px rgba(0,229,255,0.32),
        0 0 44px rgba(0,229,255,0.14),
        0 8px 28px rgba(0,0,0,0.5),
        inset 0 1px 0 rgba(255,255,255,0.14) !important;
      transform: scale(1.04) translateY(-1px);
    }
    .cs-srch-squircle {
      transition: box-shadow 0.55s ease, border-color 0.45s ease,
                  transform 0.35s ease, background 0.45s ease;
    }
    .cs-srch-squircle:hover {
      transition: box-shadow 0.16s ease, border-color 0.12s ease,
                  transform 0.22s cubic-bezier(0.34,1.56,0.64,1), background 0.16s ease;
      background: rgba(255,255,255,0.06);
      border-color: rgba(255,255,255,0.32) !important;
      box-shadow:
        0 0 0 1px rgba(255,255,255,0.26),
        0 0 14px rgba(255,255,255,0.10),
        0 0 34px rgba(255,255,255,0.04),
        0 8px 28px rgba(0,0,0,0.5),
        inset 0 1px 0 rgba(255,255,255,0.16) !important;
      transform: scale(1.04) translateY(-1px);
    }
  `;
  document.head.appendChild(s);

  // Inter — crisp geometric UI typeface for the search bar.
  if (!document.getElementById('cs-inter-font')) {
    const f = document.createElement('link');
    f.id = 'cs-inter-font';
    f.rel = 'stylesheet';
    f.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap';
    document.head.appendChild(f);
  }
}

// Inter stack for the destination search bar.
const FONT = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

// ── Design tokens ─────────────────────────────────────────────────────────────

const C = {
  surface:  '#111111',
  surface2: '#1a1a1a',
  border:   'rgba(255,255,255,0.08)',
  text:     '#ffffff',
  muted:    'rgba(255,255,255,0.45)',
  faint:    'rgba(255,255,255,0.22)',
  cyan:     '#00e5ff',
  green:    '#34d399',
  yellow:   '#fbbf24',
  purple:   '#a78bfa',
  orange:   '#f97316',
  red:      '#ef4444',
} as const;

// Accent colour per modality
const MODALITY_COLOR: Record<string, string> = {
  train:        C.cyan,
  parking:      C.green,
  taxi:         C.yellow,
  bike_sharing: C.purple,
};

// ── SVG icons ─────────────────────────────────────────────────────────────────

const Ico = {
  Search: () => (
    <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
    </svg>
  ),
  Train: () => (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <rect x="4" y="3" width="16" height="16" rx="2"/>
      <path d="M4 11h16M12 3v8M8 19l4-4 4 4"/>
    </svg>
  ),
  Parking: () => (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <path d="M9 17V7h4a3 3 0 0 1 0 6H9"/>
    </svg>
  ),
  Taxi: () => (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M5 17H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h11l4 4v4a2 2 0 0 1-2 2h-2"/>
      <circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>
      <path d="M5 9V7"/>
    </svg>
  ),
  Bike: () => (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/>
      <path d="M15 6a1 1 0 0 0-1 1v5H9L7 6"/><path d="M5 6h5l.5 1"/>
    </svg>
  ),
  MapPin: () => (
    <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
      <circle cx="12" cy="10" r="3"/>
    </svg>
  ),
  X: () => (
    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" viewBox="0 0 24 24">
      <path d="M18 6 6 18M6 6l12 12"/>
    </svg>
  ),
  Check: () => (
    <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M20 6 9 17l-5-5"/>
    </svg>
  ),
  ArrowRight: () => (
    <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M5 12h14M12 5l7 7-7 7"/>
    </svg>
  ),
  Clock: () => (
    <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
    </svg>
  ),
};

// Modality icon lookup
function ModalityIcon({ type }: { type: string }) {
  if (type === 'train')        return <Ico.Train />;
  if (type === 'parking')      return <Ico.Parking />;
  if (type === 'taxi')         return <Ico.Taxi />;
  if (type === 'bike_sharing') return <Ico.Bike />;
  return null;
}

// Modality label lookup
const MODALITY_LABEL: Record<string, string> = {
  train:        'Treno Regionale',
  parking:      'Parcheggio',
  taxi:         'Taxi',
  bike_sharing: 'Bike Sharing',
};

// ── Shared primitives ─────────────────────────────────────────────────────────

function Spinner({ size = 20, color = C.cyan }: { size?: number; color?: string }) {
  return (
    <div className="cs-spinner" style={{
      width: size, height: size, flexShrink: 0,
      border: `2px solid rgba(255,255,255,0.12)`,
      borderTopColor: color,
      borderRadius: '50%',
    }} />
  );
}

const SQUIRCLE_BASE: CSSProperties = {
  width: 44, height: 60, flexShrink: 0,
  background: 'rgba(17,19,27,0.82)',
  backdropFilter: 'blur(30px) saturate(180%)',
  WebkitBackdropFilter: 'blur(30px) saturate(180%)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 16,
  boxShadow: '0 8px 32px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', padding: 0,
};

function AISquircle({ onToggle }: { onToggle: () => void }) {
  return (
    <button className="cs-ai-squircle" onClick={onToggle} style={SQUIRCLE_BASE} aria-label="AI Planner">
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
        <path d="M7.5 1.5L8.75 6.25L13.5 7.5L8.75 8.75L7.5 13.5L6.25 8.75L1.5 7.5L6.25 6.25Z" fill="#00e5ff"/>
      </svg>
    </button>
  );
}

function SearchSquircle({ onToggle }: { onToggle: () => void }) {
  return (
    <button className="cs-srch-squircle" onClick={onToggle} style={{ ...SQUIRCLE_BASE, color: 'rgba(255,255,255,0.6)' }} aria-label="Cerca destinazione">
      <Ico.Search />
    </button>
  );
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '--:--';
  }
}

// Parking availability: green ≥ 50 %, yellow 20–50 %, red < 20 %
function availColor(avail: number, total: number): string {
  const pct = avail / total;
  if (pct >= 0.5) return C.green;
  if (pct >= 0.2) return C.yellow;
  return C.red;
}

// ── Capacity bar (used for train + parking) ───────────────────────────────────

function CapBar({ avail, total, color }: { avail: number; total: number; color: string }) {
  const usedPct = Math.round(((total - avail) / total) * 100);
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Disponibilità
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, color }}>
          {avail}/{total} liberi
        </span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
        <div className="cs-cap-bar" style={{ height: '100%', width: `${100 - usedPct}%`, background: color, borderRadius: 2 }} />
      </div>
    </div>
  );
}

// ── Skeleton loader ───────────────────────────────────────────────────────────

function SkeletonList() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {[90, 70, 80, 60].map((w, i) => (
        <div key={i} style={{
          borderRadius: 18, padding: '16px',
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div className="cs-skeleton" style={{ width: 40, height: 40, borderRadius: 12 }} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="cs-skeleton" style={{ height: 12, width: `${w}%` }} />
              <div className="cs-skeleton" style={{ height: 9,  width: '40%' }} />
            </div>
            <div className="cs-skeleton" style={{ width: 70, height: 30, borderRadius: 10 }} />
          </div>
          <div className="cs-skeleton" style={{ height: 4, width: '100%' }} />
        </div>
      ))}
    </div>
  );
}

// ── Mock QR ───────────────────────────────────────────────────────────────────

function MockQR({ payload }: { payload: string }) {
  const SIZE = 17, CELL = 7;
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
  function finder(r0: number, c0: number) {
    for (let dr = 0; dr < 7; dr++)
      for (let dc = 0; dc < 7; dc++) {
        const r = r0 + dr, c = c0 + dc;
        if (r >= SIZE || c >= SIZE) continue;
        cells[r][c] = (dr === 0 || dr === 6 || dc === 0 || dc === 6)
          || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
      }
  }
  finder(0, 0); finder(0, SIZE - 7); finder(SIZE - 7, 0);
  const px = SIZE * CELL;
  return (
    <div style={{ background: '#fff', padding: 7, borderRadius: 10, display: 'inline-block', flexShrink: 0 }}>
      <svg width={px} height={px} viewBox={`0 0 ${px} ${px}`}>
        {cells.map((row, r) => row.map((on, c) =>
          on ? <rect key={`${r}-${c}`} x={c * CELL} y={r * CELL} width={CELL} height={CELL} fill="#000" /> : null
        ))}
      </svg>
    </div>
  );
}

// ── Modality card ─────────────────────────────────────────────────────────────

function ModalityCard({
  modality,
  isBeingBooked,
  anyBeingBooked,
  onBook,
}: {
  modality: ModalityOption;
  isBeingBooked: boolean;
  anyBeingBooked: boolean;
  onBook: (id: string) => void;
}) {
  const color  = MODALITY_COLOR[modality.type] ?? C.cyan;
  const label  = MODALITY_LABEL[modality.type] ?? modality.type;
  const disabled = anyBeingBooked;

  return (
    <div
      className={`cs-modality-card${isBeingBooked ? ' cs-booking' : ''}`}
      style={{
        borderRadius: 18,
        padding: '15px 16px',
        // Glassmorphism surface
        background:     'rgba(255,255,255,0.025)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: `1px solid ${isBeingBooked ? color + '55' : 'rgba(255,255,255,0.08)'}`,
        boxShadow: isBeingBooked
          ? `0 4px 24px ${color}22, inset 0 1px 0 rgba(255,255,255,0.06)`
          : '0 2px 12px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04)',
        display: 'flex', flexDirection: 'column', gap: 11,
        opacity: anyBeingBooked && !isBeingBooked ? 0.5 : 1,
        transition: 'opacity 0.2s ease',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Icon badge */}
        <div style={{
          width: 40, height: 40, borderRadius: 12, flexShrink: 0,
          background: color + '18',
          border: `1px solid ${color}40`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color,
        }}>
          <ModalityIcon type={modality.type} />
        </div>

        {/* Title + subtitle */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{label}</div>
          <ModalitySubtitle modality={modality} color={color} />
        </div>

        {/* Price + Prenota button */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>
            €&thinsp;{modality.price_eur.toFixed(2)}
          </div>
          <button
            className="cs-btn-book"
            disabled={disabled}
            onClick={() => !disabled && onBook(modality.option_id)}
            style={{
              padding: '6px 14px',
              background: isBeingBooked ? 'rgba(255,255,255,0.08)' : color,
              color: isBeingBooked ? C.text : '#000',
              border: 'none', borderRadius: 10,
              fontSize: 11, fontWeight: 800,
              cursor: disabled ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', letterSpacing: '0.03em',
              display: 'flex', alignItems: 'center', gap: 5,
              minWidth: 80, justifyContent: 'center',
            }}
          >
            {isBeingBooked ? <Spinner size={14} color={C.text} /> : <>Prenota <Ico.ArrowRight /></>}
          </button>
        </div>
      </div>

      {/* Capacity / extra line */}
      <ModalityDetail modality={modality} color={color} />
    </div>
  );
}

// Secondary text under title
function ModalitySubtitle({ modality, color }: { modality: ModalityOption; color: string }) {
  if (modality.type === 'train') {
    const m = modality as TrainModality;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
        <span style={{ fontSize: 11, color, fontWeight: 600 }}>{m.track}</span>
        <span style={{ fontSize: 10, color: C.muted }}>· Bin. {m.platform}</span>
        <span style={{ fontSize: 10, color: C.faint }}>· {fmtTime(m.departure_time)}</span>
      </div>
    );
  }
  if (modality.type === 'parking') {
    const m = modality as ParkingModality;
    return (
      <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{m.description}</div>
    );
  }
  if (modality.type === 'taxi') {
    const m = modality as TaxiModality;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
        <span style={{ fontSize: 11, color: C.muted }}>{m.vehicle_model}</span>
        <span style={{ fontSize: 10, color: C.faint }}>· {m.driver_name}</span>
      </div>
    );
  }
  // bike_sharing
  const m = modality as BikeSharingModality;
  return <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{m.station_name}</div>;
}

// Bottom detail row (capacity bar or info line)
function ModalityDetail({ modality, color }: { modality: ModalityOption; color: string }) {
  if (modality.type === 'train') {
    const m = modality as TrainModality;
    return <CapBar avail={m.available_seats} total={m.total_seats} color={color} />;
  }

  if (modality.type === 'parking') {
    const m = modality as ParkingModality;
    const ac = availColor(m.available_spots, m.total_spots);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: C.muted, fontSize: 10 }}>
            <Ico.MapPin /><span>{m.distance_meters}m dalla stazione</span>
          </div>
          <span style={{
            fontSize: 12, fontWeight: 800, color: ac,
            background: ac + '18', border: `1px solid ${ac}40`,
            borderRadius: 6, padding: '2px 8px',
          }}>
            {m.available_spots}/{m.total_spots} posti liberi
          </span>
        </div>
        <CapBar avail={m.available_spots} total={m.total_spots} color={ac} />
      </div>
    );
  }

  if (modality.type === 'taxi') {
    const m = modality as TaxiModality;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.muted, fontSize: 10 }}>
        <Ico.Clock />
        <span>ETA circa <strong style={{ color: C.yellow }}>{m.eta_minutes} minuti</strong></span>
        <span style={{ marginLeft: 'auto', color: C.faint }}>{m.plate}</span>
      </div>
    );
  }

  // bike_sharing
  const m = modality as BikeSharingModality;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: C.muted, fontSize: 10 }}>
        <Ico.MapPin /><span>{m.distance_meters}m dalla stazione</span>
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color: C.purple }}>
        {m.available_bikes} bici · {m.available_docks} dock
      </span>
    </div>
  );
}

// ── Modality list (the selection phase) ───────────────────────────────────────

function ModalityList({
  modalities,
  bookingOptionId,
  onBook,
  error,
}: {
  modalities: ModalityOption[];
  bookingOptionId: string | null;
  onBook: (id: string) => void;
  error: string | null;
}) {
  const anyBooking = bookingOptionId !== null;

  return (
    <div className="cs-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Section label */}
      <div style={{
        fontSize: 10, fontWeight: 700, color: C.muted,
        textTransform: 'uppercase', letterSpacing: '0.1em',
        paddingLeft: 2, marginBottom: 2,
      }}>
        Scegli come andare
      </div>

      {modalities.map((m) => (
        <ModalityCard
          key={m.option_id}
          modality={m}
          isBeingBooked={m.option_id === bookingOptionId}
          anyBeingBooked={anyBooking}
          onBook={onBook}
        />
      ))}

      {error && (
        <div style={{
          background: '#ef444418', border: '1px solid #ef444440',
          borderRadius: 10, padding: '10px 14px',
          fontSize: 12, color: '#ef4444', fontWeight: 500,
        }}>
          {error}
        </div>
      )}

      <p style={{ margin: 0, fontSize: 10, color: C.faint, textAlign: 'center', lineHeight: 1.6 }}>
        Opzioni valide per 10 min · Cancellazione gratuita entro 15 min
      </p>
    </div>
  );
}

// ── Boarding pass view ────────────────────────────────────────────────────────

function InfoRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: C.faint, textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color, lineHeight: 1.2 }}>{value}</div>
    </div>
  );
}

function BoardingPassView({ confirmation }: { confirmation: TripBookResponse }) {
  const bp    = confirmation.boarding_pass;
  const color = MODALITY_COLOR[bp.modality_type] ?? C.cyan;

  return (
    <div className="cs-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{
        borderRadius: 20, overflow: 'hidden',
        border: `1px solid ${color}33`,
        background: 'linear-gradient(140deg, #0f1628 0%, #1a1040 100%)',
        boxShadow: `0 12px 40px rgba(0,0,0,0.6), 0 0 0 1px ${color}12`,
      }}>
        {/* Header strip */}
        <div style={{
          background: color + '14',
          borderBottom: '1px dashed rgba(255,255,255,0.10)',
          padding: '14px 18px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 9, color, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              CommuteSync · Boarding Pass
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.text, marginTop: 3 }}>
              {bp.title}
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{bp.subtitle}</div>
          </div>
          <div style={{
            background: C.green + '22', border: `1px solid ${C.green}55`,
            borderRadius: 8, padding: '5px 10px',
            fontSize: 9, fontWeight: 800, color: C.green, letterSpacing: '0.06em',
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <Ico.Check /> CONFERMATO
          </div>
        </div>

        {/* QR + details */}
        <div style={{ padding: '16px 18px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <MockQR payload={bp.qr_payload} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <InfoRow label="Origine"     value={bp.origin}      color={C.text} />
            <InfoRow label="Destinazione" value={bp.destination.split(' ').pop()!} color={color} />
            {bp.detail_lines.map((dl) => (
              <InfoRow key={dl.label} label={dl.label} value={dl.value} color={C.text} />
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          borderTop: '1px dashed rgba(255,255,255,0.08)',
          padding: '10px 18px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: 9, color: C.faint }}>ID prenotazione</span>
          <span style={{ fontSize: 11, fontWeight: 800, color: C.muted, letterSpacing: '0.1em' }}>
            {bp.booking_id}
          </span>
        </div>
      </div>

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
        <Ico.MapPin /> Naviga alla destinazione <Ico.ArrowRight />
      </button>

      <p style={{ margin: 0, fontSize: 10, color: C.faint, textAlign: 'center' }}>
        Confermato alle {fmtTime(confirmation.confirmed_at)}
      </p>
    </div>
  );
}

// ── Destination search bar (idle state) ───────────────────────────────────────

export interface SuggestionItem {
  name: string;
  category?: 'stations' | 'taxi' | 'carsharing' | 'parking';
}

const DEFAULT_SUGGESTIONS: SuggestionItem[] = [
  { name: 'Stazione FS Rovereto', category: 'stations' },
  { name: 'Stazione FS Trento',   category: 'stations' },
];

const SUGGESTION_LIMIT = 8;

const CAT_COLOR: Record<NonNullable<SuggestionItem['category']>, string> = {
  stations:   C.cyan,
  taxi:       C.yellow,
  carsharing: C.purple,
  parking:    C.green,
};

const CAT_LABEL: Record<NonNullable<SuggestionItem['category']>, string> = {
  stations:   'Stazione',
  taxi:       'Taxi',
  carsharing: 'Car sharing',
  parking:    'Parcheggio',
};

function SearchBar({
  onSearch,
  suggestions: source = DEFAULT_SUGGESTIONS,
}: {
  onSearch: (dest: string) => void;
  suggestions?: SuggestionItem[];
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen]   = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = useCallback((dest: string) => {
    if (!dest.trim()) return;
    setQuery(dest);
    setOpen(false);
    onSearch(dest);
  }, [onSearch]);

  const clear = useCallback(() => {
    setQuery('');
    setOpen(false);
    inputRef.current?.focus();
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = (q ? source.filter((s) => s.name.toLowerCase().includes(q)) : source);
  const suggestions = filtered.slice(0, SUGGESTION_LIMIT);
  const showList = open && suggestions.length > 0;

  return (
    <div className="cs-fade-in" style={{ width: '100%' }}>
      <div
        className="cs-searchbar"
        style={{
          background: 'rgba(17,19,27,0.82)',
          backdropFilter: 'blur(30px) saturate(180%)',
          WebkitBackdropFilter: 'blur(30px) saturate(180%)',
          borderRadius: showList ? '22px 22px 16px 16px' : 22,
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08)',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 14px' }}>
          <div className="cs-search-badge" style={{
            width: 36, height: 36, borderRadius: 12, flexShrink: 0,
            background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.14)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'rgba(255,255,255,0.65)',
          }}>
            <Ico.Search />
          </div>
          <input
            ref={inputRef}
            className="cs-search-input"
            style={{
              flex: 1, background: 'transparent', border: 'none',
              color: C.text, fontSize: 15, fontWeight: 500,
              fontFamily: FONT, letterSpacing: '-0.01em',
            }}
            placeholder="Dove vuoi andare?"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 160)}
            onKeyDown={(e) => e.key === 'Enter' && submit(query)}
          />
          {query.length > 0 && (
            <button
              className="cs-clear-btn"
              onClick={clear}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '4px 2px', display: 'flex', alignItems: 'center',
                color: 'rgba(255,255,255,0.40)', opacity: 0.7, flexShrink: 0,
              }}
              aria-label="Cancella"
            >
              <Ico.X />
            </button>
          )}
          <button
            className="cs-search-btn"
            onClick={() => submit(query)}
            style={{
              padding: '8px 15px', background: C.cyan, color: '#04121a',
              border: 'none', borderRadius: 11, fontSize: 12, fontWeight: 700,
              cursor: 'pointer', fontFamily: FONT, letterSpacing: '0.01em', flexShrink: 0,
            }}
          >
            Cerca →
          </button>
        </div>

        {showList && (
          <div style={{
            borderTop: '1px solid rgba(255,255,255,0.08)',
            paddingBottom: 6,
            maxHeight: 320,
            overflowY: 'auto',
          }}>
            {suggestions.map((s, i) => {
              const accent = s.category ? CAT_COLOR[s.category] : C.muted;
              const label  = s.category ? CAT_LABEL[s.category] : null;
              return (
                <button
                  key={`${s.name}-${i}`}
                  className="cs-suggestion"
                  onMouseDown={() => submit(s.name)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    width: '100%', padding: '10px 14px',
                    background: 'transparent', border: 'none',
                    color: C.text, fontSize: 13, fontWeight: 500,
                    fontFamily: FONT, letterSpacing: '-0.01em',
                    cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <span style={{ color: accent, display: 'flex', flexShrink: 0 }}><Ico.MapPin /></span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.name}
                  </span>
                  {label && (
                    <span style={{
                      fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em',
                      textTransform: 'uppercase', color: accent,
                      background: accent + '14', border: `1px solid ${accent}33`,
                      borderRadius: 6, padding: '2px 7px', flexShrink: 0,
                    }}>{label}</span>
                  )}
                </button>
              );
            })}
            {filtered.length > SUGGESTION_LIMIT && (
              <div style={{
                padding: '6px 14px 2px', fontSize: 10, color: C.faint,
                fontFamily: FONT, letterSpacing: '0.04em',
              }}>
                +{filtered.length - SUGGESTION_LIMIT} altri risultati — affina la ricerca
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sheet panel ───────────────────────────────────────────────────────────────

const SHEET_HEIGHT: Record<string, string> = {
  searching: '176px',
  selecting: 'min(72vh, 620px)',
  booking:   'min(72vh, 620px)',
  confirmed: 'min(66vh, 540px)',
};

function SheetPanel({
  state,
  query,
  onBook,
  onDismiss,
  dismissing,
}: {
  state: ReturnType<typeof useBooking>['state'];
  query: string;
  onBook: (id: string) => void;
  onDismiss: () => void;
  dismissing: boolean;
}) {
  const { phase, modalities, bookingOptionId, confirmation, error } = state;
  const height    = SHEET_HEIGHT[phase] ?? '0';
  const confirmed = phase === 'confirmed';
  const searching = phase === 'searching';
  const accent    = confirmed ? C.green : C.cyan;

  const destLabel =
    state.destination ??
    confirmation?.boarding_pass.destination ??
    query;

  return (
    // Full width of the shared container, so it lines up with the search bar.
    <div style={{ width: '100%' }}>
      <div
        className={dismissing ? 'cs-pane-out' : 'cs-pane-in'}
        style={{
          fontFamily: FONT,
          // Frosted glass — grows upward out of the search bar below it.
          background: 'rgba(17,19,27,0.82)',
          backdropFilter: 'blur(30px) saturate(180%)',
          WebkitBackdropFilter: 'blur(30px) saturate(180%)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 24,
          boxShadow: '0 28px 80px rgba(0,0,0,0.78), inset 0 1px 0 rgba(255,255,255,0.08)',
          height,
          maxHeight: 'calc(100vh - 120px)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          transition: 'height 0.4s cubic-bezier(0.16,1,0.3,1)',
        }}
      >
        {/* Header */}
        <div style={{
          flexShrink: 0, display: 'flex', alignItems: 'center', gap: 11,
          padding: '12px 13px',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
        }}>
          {/* Status badge: spinner while searching, check when confirmed, pin otherwise */}
          <div style={{
            width: 36, height: 36, borderRadius: 12, flexShrink: 0,
            background: accent + '18', border: `1px solid ${accent}33`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: accent,
          }}>
            {confirmed ? <Ico.Check /> : searching ? <Spinner size={16} /> : <Ico.MapPin />}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 9.5, fontWeight: 700, color: accent === C.cyan ? C.muted : accent,
              textTransform: 'uppercase', letterSpacing: '0.11em',
            }}>
              {confirmed ? 'Prenotazione confermata' : searching ? 'Ricerca in corso' : 'Destinazione'}
            </div>
            <div style={{
              fontSize: 15, fontWeight: 700, color: C.text, letterSpacing: '-0.01em',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1,
            }}>
              {searching ? 'Ricerca opzioni…' : destLabel}
            </div>
          </div>

          {/* Close — conventional top-right placement */}
          <button
            className="cs-icon-btn"
            onClick={onDismiss}
            aria-label="Chiudi"
            style={{
              width: 32, height: 32, borderRadius: 10, flexShrink: 0,
              background: 'rgba(255,255,255,0.06)', border: `1px solid ${C.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: C.muted, fontFamily: FONT,
            }}
          >
            <Ico.X />
          </button>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '15px 14px 16px' }}>
          {searching && (
            <div className="cs-fade-in" style={{
              height: '100%', display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 12,
            }}>
              <Spinner size={26} />
              <span style={{ fontSize: 13, color: C.muted, fontWeight: 500 }}>
                Ricerca opzioni disponibili…
              </span>
            </div>
          )}

          {(phase === 'selecting' || phase === 'booking') && (
            modalities.length > 0
              ? <ModalityList modalities={modalities} bookingOptionId={bookingOptionId} onBook={onBook} error={error} />
              : <SkeletonList />
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
  searchTrigger?: { destination: string; nonce: number } | null;
  suggestions?: SuggestionItem[];
  /** Live user position passed to the AI planner so it routes from the user. */
  aiOrigin?: { lat: number; lng: number } | null;
  /** Fired with the itinerary the AI planner chose — draw it on the map. */
  onAIPlan?: (suggestion: RouteSuggestion) => void;
  /** Fired when the AI plan is dismissed — clear the route from the map. */
  onAIClear?: () => void;
  /** Ask the host to start geolocation for the AI planner. */
  onAIRequestLocation?: () => void;
}

export default function BookingSheet({
  onRouteReady, searchTrigger, suggestions,
  aiOrigin, onAIPlan, onAIClear, onAIRequestLocation,
}: Props) {
  const { state, search, book, dismiss } = useBooking();
  const [query, setQuery] = useState('');
  const [dismissing, setDismissing] = useState(false);
  const [aiActive, setAiActive] = useState(false);
  const lastNonce = useRef<number | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { injectStyles(); }, []);

  const handleDismiss = useCallback(() => {
    setDismissing(true);
    dismissTimer.current = setTimeout(() => {
      dismiss();
      setDismissing(false);
    }, 280);
  }, [dismiss]);

  useEffect(() => () => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
  }, []);

  // Auto-trigger from map "Naviga →" click — also ensures search panel is visible
  useEffect(() => {
    if (searchTrigger && searchTrigger.nonce !== lastNonce.current) {
      lastNonce.current = searchTrigger.nonce;
      setQuery(searchTrigger.destination);
      search(searchTrigger.destination);
      setAiActive(false);
    }
  }, [searchTrigger, search]);

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

  // Outer column anchors everything. Top row uses alignItems:stretch so the
  // squircle grows to the same height as the search bar / AI panel.
  return (
    <div style={{
      position: 'fixed', top: 28, left: '50%', transform: 'translateX(-50%)',
      zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 10,
      width: 'min(492px, calc(100vw - 48px))',
    }}>
      {/* Top row — squircle is fixed height matching the search bar */}
      <div style={{ display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
        {aiActive
          ? <SearchSquircle onToggle={() => setAiActive(false)} />
          : <AISquircle onToggle={() => setAiActive(true)} />
        }
        <div style={{ flex: 1, minWidth: 0 }}>
          {aiActive ? (
            <AIPlannerPanel
              origin={aiOrigin ?? null}
              onPlanReady={(s) => onAIPlan?.(s)}
              onClear={() => onAIClear?.()}
              onRequestLocation={onAIRequestLocation}
            />
          ) : (
            <SearchBar onSearch={handleSearch} suggestions={suggestions} />
          )}
        </div>
      </div>

      {/* Sheet panel — offset left to align with the right panel */}
      {(state.phase !== 'idle' || dismissing) && (
        <div style={{ marginLeft: 52 }}>
          <SheetPanel
            state={state}
            query={query}
            onBook={book}
            onDismiss={handleDismiss}
            dismissing={dismissing}
          />
        </div>
      )}
    </div>
  );
}
