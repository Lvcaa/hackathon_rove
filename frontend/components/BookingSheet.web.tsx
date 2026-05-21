import React, { useState, useEffect, useCallback, useRef, CSSProperties } from 'react';
import { useBooking } from '../hooks/useBooking';
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
    @keyframes cs-slide-up {
      from { transform: translateY(110%); opacity: 0; }
      to   { transform: translateY(0);    opacity: 1; }
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

    .cs-slide-up { animation: cs-slide-up 0.38s cubic-bezier(0.16,1,0.3,1) both; }
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
    .cs-suggestion:hover { background: rgba(255,255,255,0.05) !important; }
    .cs-icon-btn:hover { background: rgba(255,255,255,0.1) !important; }

    .cs-cap-bar { transition: width 0.7s cubic-bezier(0.16,1,0.3,1); }
  `;
  document.head.appendChild(s);
}

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

const SUGGESTIONS = ['Stazione FS Rovereto', 'Stazione FS Trento'];

function SearchBar({ onSearch }: { onSearch: (dest: string) => void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen]   = useState(false);

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
        borderRadius: open ? '18px 18px 14px 14px' : 20,
        border: `1px solid ${C.border}`,
        boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
        overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
          <div style={{
            width: 34, height: 34, borderRadius: 11, flexShrink: 0,
            background: C.cyan + '18', border: `1px solid ${C.cyan}30`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.cyan,
          }}>
            <Ico.Search />
          </div>
          <input
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
              cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.02em', flexShrink: 0,
            }}
          >
            Cerca →
          </button>
        </div>

        {open && (
          <div style={{ borderTop: `1px solid ${C.border}`, paddingBottom: 6 }}>
            {SUGGESTIONS.filter((s) => !query || s.toLowerCase().includes(query.toLowerCase())).map((s) => (
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

// ── Sheet panel ───────────────────────────────────────────────────────────────

const SHEET_HEIGHT: Record<string, string> = {
  searching: '180px',
  selecting: 'min(82vh, 680px)',
  booking:   'min(82vh, 680px)',
  confirmed: 'min(75vh, 600px)',
};

function SheetPanel({
  state,
  query,
  onBook,
  onDismiss,
}: {
  state: ReturnType<typeof useBooking>['state'];
  query: string;
  onBook: (id: string) => void;
  onDismiss: () => void;
}) {
  const { phase, modalities, bookingOptionId, confirmation, error } = state;
  const height    = SHEET_HEIGHT[phase] ?? '0';
  const confirmed = phase === 'confirmed';

  const destLabel =
    state.destination ??
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
          width: 'min(520px, 100%)',
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
        <div style={{ flexShrink: 0, padding: '12px 18px 14px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.15)', margin: '0 auto 12px' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              className="cs-icon-btn"
              onClick={onDismiss}
              style={{
                width: 32, height: 32, borderRadius: 10, flexShrink: 0,
                background: 'rgba(255,255,255,0.06)', border: `1px solid ${C.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: C.muted,
              }}
            >
              <Ico.X />
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                {confirmed ? 'Prenotazione confermata' : phase === 'searching' ? 'Ricerca in corso' : 'Destinazione'}
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {phase === 'searching' ? 'Ricerca opzioni…' : destLabel}
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
            <div className="cs-fade-in" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
              <Spinner size={28} />
              <span style={{ fontSize: 14, color: C.muted, fontWeight: 500 }}>Ricerca opzioni disponibili…</span>
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
}

export default function BookingSheet({ onRouteReady }: Props) {
  const { state, search, book, dismiss } = useBooking();
  const [query, setQuery] = useState('');

  useEffect(() => { injectStyles(); }, []);

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

  if (state.phase === 'idle') {
    return <SearchBar onSearch={handleSearch} />;
  }

  return (
    <SheetPanel
      state={state}
      query={query}
      onBook={book}
      onDismiss={dismiss}
    />
  );
}
