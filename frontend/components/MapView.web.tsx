import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import {
  MapContainer, TileLayer, Marker, CircleMarker, Circle,
  Polygon, Polyline, Popup, Pane, ZoomControl, useMap,
} from 'react-leaflet';
import L from 'leaflet';
import {
  MobilityData, MobilityFeature, MobilityCollection, CategoryKey,
  BusVehicle, BusKind, StopSchedule, Departure,
  TrainVehicle, RailCollection, TrainBoard,
} from '../types/mobility';
import { LiveLocation, LocationStatus } from '../hooks/useLiveLocation';
import { RouteSuggestion, MODE_META } from '../types/routing';
import {
  CategoryColors, CategoryIcons, CategoryLabels, TrainStationColor,
} from '../constants/colors';

interface Props {
  data: MobilityData;
  busStops: MobilityCollection;
  busVehicles: BusVehicle[];
  trainStations: MobilityCollection;
  rail: RailCollection;
  trainVehicles: TrainVehicle[];
  visibleCategories: Set<CategoryKey>;
  selectedFeature: MobilityFeature | null;
  onFeatureSelect: (feature: MobilityFeature, category: CategoryKey) => void;
  onNavigate?: (feature: MobilityFeature, category: CategoryKey) => void;
  userLocation?: LiveLocation | null;
  locationStatus?: LocationStatus;
  recenterNonce?: number;
  onLocate?: () => void;
  activeRoute?: RouteSuggestion | null;
  onOpenRouting?: () => void;
  routingPanelOpen?: boolean;
}

const TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
const CENTER: [number, number] = [46.072, 11.121];
const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';

// A bus stop feature's `kind` property → BusKind (defaults to urban).
const stopKind = (f: MobilityFeature): BusKind =>
  f.properties.kind === 'extraurban' ? 'extraurban' : 'urban';

// Trentino Trasporti livery: urban (città) buses are green, extraurban
// (suburban/valley) buses are blue.
const BUS_URBAN = '#76b82a';
const BUS_EXTRA = '#1c86cf';
const busColor = (kind: BusKind) => (kind === 'extraurban' ? BUS_EXTRA : BUS_URBAN);
const busKindLabel = (kind: BusKind) => (kind === 'extraurban' ? 'Extraurbano' : 'Urbano');

// ── CSS injection ─────────────────────────────────────────────────────────────

function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById('cs-leaflet-css')) return;

  const link = document.createElement('link');
  link.id = 'cs-leaflet-css';
  link.rel = 'stylesheet';
  link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  document.head.appendChild(link);

  const style = document.createElement('style');
  style.id = 'cs-map-styles';
  style.textContent = `
    html, body { margin:0; padding:0; }
    .leaflet-container { background:#0d1117 !important; font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif; }

    /* Popups always sit on the very top pane, above buses and stops. */
    .leaflet-popup-pane { z-index: 9999 !important; }

    /* Frosted-glass popup card — translucent so the map shows through. */
    .leaflet-popup-content-wrapper {
      background:rgba(16,17,23,0.62) !important;
      backdrop-filter:blur(28px) saturate(180%); -webkit-backdrop-filter:blur(28px) saturate(180%);
      border:1px solid rgba(255,255,255,0.16) !important;
      border-radius:16px !important;
      box-shadow:0 16px 48px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.12) !important;
      padding:0 !important; color:#fff !important; min-width:200px;
    }
    .leaflet-popup-content { margin:0 !important; color:#fff !important; }
    .leaflet-popup-tip-container { display:none !important; }
    .leaflet-popup-close-button {
      color:rgba(255,255,255,0.4) !important; font-size:18px !important;
      top:10px !important; right:12px !important;
      width:24px !important; height:24px !important; line-height:24px !important;
    }
    .leaflet-popup-close-button:hover { color:#fff !important; background:transparent !important; }

    .leaflet-control-attribution {
      background:rgba(0,0,0,0.6) !important; color:rgba(255,255,255,0.3) !important;
      font-size:9px !important; border-radius:6px 0 0 0 !important;
    }
    .leaflet-control-attribution a { color:rgba(255,255,255,0.4) !important; }

    /* Zoom control: dissolve the bar into two individual glass pills */
    .leaflet-control-zoom.leaflet-bar {
      display:flex !important; flex-direction:column !important; gap:6px !important;
      background:transparent !important; border:none !important;
      box-shadow:none !important; border-radius:0 !important; overflow:visible !important;
    }
    .leaflet-control-zoom a {
      width:44px !important; height:44px !important; line-height:44px !important;
      background:rgba(18,18,20,0.55) !important;
      backdrop-filter:blur(22px) saturate(180%) !important;
      -webkit-backdrop-filter:blur(22px) saturate(180%) !important;
      border:1px solid rgba(255,255,255,0.14) !important;
      border-radius:16px !important;
      box-shadow:0 8px 28px rgba(0,0,0,0.55),inset 0 1px 0 rgba(255,255,255,0.12) !important;
      color:rgba(255,255,255,0.88) !important;
      display:flex !important; align-items:center !important; justify-content:center !important;
      text-decoration:none !important;
      transition:background 0.15s ease,border-color 0.15s ease !important;
    }
    .leaflet-control-zoom a svg { display:block; pointer-events:none; }
    .leaflet-control-zoom a:hover {
      background:rgba(28,30,40,0.78) !important;
      border-color:rgba(255,255,255,0.26) !important; color:#fff !important;
    }

    /* Live bus pulse. The glow is a separate radial-gradient layer animated
       only with transform+opacity (compositor-only) — far cheaper per frame
       than animating a drop-shadow filter on hundreds of markers. */
    @keyframes cs-glow-pulse {
      0%, 100% { transform: scale(0.62); opacity: 0.42; }
      50%      { transform: scale(1.22); opacity: 0.85; }
    }
    .cs-bus-wrap { position:relative; width:26px; height:40px; }
    .cs-bus-wrap.ghost { opacity:0.42; }
    .cs-bus-rot { line-height:0; transform-origin:13px 20px;
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.55)); }
    .cs-bus-glow {
      position:absolute; left:13px; top:20px; width:42px; height:42px;
      margin:-21px 0 0 -21px; border-radius:50%; pointer-events:none;
      will-change:transform,opacity;
      animation: cs-glow-pulse 2.4s ease-in-out infinite;
    }
    .cs-bus-glow.urban { background:radial-gradient(closest-side, rgba(118,184,42,0.9), rgba(118,184,42,0)); }
    .cs-bus-glow.extra { background:radial-gradient(closest-side, rgba(28,134,207,0.9), rgba(28,134,207,0)); }

    /* Neon route preview line shown when a bus is tapped. */
    .cs-route-line { stroke-linecap:round; stroke-linejoin:round; }
    .cs-route-urban { filter: drop-shadow(0 0 4px #76b82a) drop-shadow(0 0 9px #76b82a); }
    .cs-route-extra { filter: drop-shadow(0 0 4px #1c86cf) drop-shadow(0 0 9px #1c86cf); }
    @keyframes cs-route-dash { to { stroke-dashoffset:-28; } }
    .cs-route-line { animation: cs-route-dash 1.1s linear infinite; }

    /* Glide the marker between polled positions (matches BUS_REFRESH_MS).
       Suppressed during zoom so buses don't lag behind the map. */
    .cs-bus-marker { transition: transform 3s linear; }
    .leaflet-zoom-anim .cs-bus-marker { transition: none; }

    /* Live user-location marker — a blue dot with an expanding sonar ring. */
    .cs-user-dot { position:relative; width:22px; height:22px; }
    .cs-user-dot-core {
      position:absolute; left:11px; top:11px; width:15px; height:15px;
      margin:-7.5px 0 0 -7.5px; border-radius:50%;
      background:#3b82f6; border:2.5px solid #fff;
      box-shadow:0 0 10px rgba(59,130,246,0.95), 0 1px 5px rgba(0,0,0,0.55);
    }
    .cs-user-dot-pulse {
      position:absolute; left:11px; top:11px; width:22px; height:22px;
      margin:-11px 0 0 -11px; border-radius:50%;
      background:rgba(59,130,246,0.5); pointer-events:none;
      will-change:transform,opacity;
      animation: cs-user-pulse 2.2s ease-out infinite;
    }
    @keyframes cs-user-pulse {
      0%   { transform:scale(0.45); opacity:0.8; }
      100% { transform:scale(3); opacity:0; }
    }
    @keyframes cs-locate-spin { to { transform:rotate(360deg); } }

    /* Live train marker — brand-coloured glow, glide between 4 s polls. */
    .cs-train-wrap { position:relative; }
    .cs-train-wrap.ghost { opacity:0.5; }
    .cs-train-rot { line-height:0; filter: drop-shadow(0 2px 5px rgba(0,0,0,0.6)); }
    .cs-train-glow {
      position:absolute; left:50%; top:50%; width:30px; height:30px;
      margin:-15px 0 0 -15px; border-radius:50%; pointer-events:none;
      will-change:transform,opacity;
      animation: cs-glow-pulse 2.8s ease-in-out infinite;
    }
    .cs-train-marker { transition: transform 4s linear; }
    .leaflet-zoom-anim .cs-train-marker { transition: none; }
  `;
  document.head.appendChild(style);
}

function StylesInjector() {
  useEffect(() => { injectStyles(); }, []);
  return null;
}

// ── Icon factories ─────────────────────────────────────────────────────────────

function createPointIcon(category: CategoryKey) {
  const color = CategoryColors[category];
  const icon = CategoryIcons[category];
  return L.divIcon({
    className: '',
    html: `<div style="
      width:38px;height:38px;border-radius:50%;
      background:${color}1a;border:2.5px solid ${color};
      display:flex;align-items:center;justify-content:center;
      font-size:17px;cursor:pointer;
      box-shadow:0 0 16px ${color}44,0 2px 8px rgba(0,0,0,0.5);
    ">${icon}</div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
    popupAnchor: [0, -22],
  });
}

// Top-down SVG bus icon. Front = top of SVG (North = 0°).
// Rotating by compass bearing directly maps to CSS rotate().
function busSvg(route: string, body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="40" viewBox="0 0 40 62" fill="none">
    <!-- Body -->
    <rect x="3" y="3" width="34" height="56" rx="9" fill="${body}"/>
    <!-- Windshield (front, top) -->
    <rect x="7" y="6" width="26" height="13" rx="5" fill="rgba(255,255,255,0.30)"/>
    <!-- Horizontal panel seams -->
    <rect x="3" y="23" width="34" height="1.5" fill="rgba(0,0,0,0.13)"/>
    <rect x="3" y="44" width="34" height="1.5" fill="rgba(0,0,0,0.13)"/>
    <!-- Left window strip -->
    <rect x="3.5" y="25" width="7" height="18" rx="3" fill="rgba(255,255,255,0.18)"/>
    <!-- Right window strip -->
    <rect x="29.5" y="25" width="7" height="18" rx="3" fill="rgba(255,255,255,0.18)"/>
    <!-- Rear lights -->
    <rect x="7" y="51" width="26" height="5" rx="3" fill="rgba(255,180,0,0.45)"/>
    <!-- Route badge on roof -->
    <rect x="11" y="26" width="18" height="13" rx="6" fill="rgba(0,0,0,0.45)"/>
    <text x="20" y="33" font-family="system-ui,-apple-system,'Inter',sans-serif" font-size="8" font-weight="800" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${route}</text>
  </svg>`;
}

function createBusVehicleIcon(route: string, bearing: number, kind: BusKind, live: boolean) {
  // Live buses get a pulsing glow layer (green/blue); schedule estimates use
  // the dimmed, no-glow `ghost` style so they read as "where the bus should
  // be", not a real fix.
  const glow = live
    ? `<div class="cs-bus-glow ${kind === 'extraurban' ? 'extra' : 'urban'}"></div>`
    : '';
  return L.divIcon({
    className: 'cs-bus-marker',
    html: `<div class="cs-bus-wrap${live ? '' : ' ghost'}">
      ${glow}
      <div class="cs-bus-rot" style="transform:rotate(${bearing}deg);">
        ${busSvg(route, busColor(kind))}
      </div>
    </div>`,
    iconSize: [26, 40],
    iconAnchor: [13, 20],   // center of bus body
    popupAnchor: [0, -22],
  });
}

// ── Popup content ──────────────────────────────────────────────────────────────

function getDisplayName(f: MobilityFeature): string {
  const p = f.properties;
  return String(p.nome || p.name || p.via || p.zona || p.descrizione || 'Posizione');
}

function FeaturePopup({ feature, category, onNavigate }: {
  feature: MobilityFeature;
  category: CategoryKey;
  onNavigate?: (feature: MobilityFeature, category: CategoryKey) => void;
}) {
  const map   = useMap();
  const color = CategoryColors[category];
  const name  = getDisplayName(feature);
  const pairs = Object.entries(feature.properties)
    .filter(([k]) => !['nome', 'name', 'zona'].includes(k) && feature.properties[k] !== null)
    .slice(0, 3);

  function handleNavigate() {
    map.closePopup();
    onNavigate?.(feature, category);
  }

  return (
    <div style={{ padding: '16px 20px 14px', minWidth: 200 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10, paddingRight: 18 }}>
        <div style={{
          width: 34, height: 34, borderRadius: '50%',
          background: color + '20', border: `1.5px solid ${color}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0,
        }}>
          {CategoryIcons[category]}
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#fff', lineHeight: 1.2 }}>{name}</div>
          <div style={{ fontSize: 11, color, marginTop: 2, fontWeight: 600 }}>{CategoryLabels[category]}</div>
        </div>
      </div>
      {pairs.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'capitalize' }}>{k}</span>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', fontWeight: 500 }}>{String(v)}</span>
        </div>
      ))}
      <div
        onClick={handleNavigate}
        style={{
          marginTop: 12, background: color + '18', border: `1px solid ${color}44`,
          borderRadius: 8, padding: '8px 0', textAlign: 'center', cursor: 'pointer',
          fontSize: 12, fontWeight: 700, color, letterSpacing: '0.02em',
          userSelect: 'none',
        }}
      >
        Naviga →
      </div>
    </div>
  );
}

const dimStyle: React.CSSProperties = {
  fontSize: 11, color: 'rgba(255,255,255,0.4)',
  padding: '12px 0 6px', textAlign: 'center', fontWeight: 500,
};

function DepartureRow({ d }: { d: Departure }) {
  const soon = d.in_min <= 2;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
      borderTop: '1px solid rgba(255,255,255,0.06)',
    }}>
      <span style={{
        background: `#${d.color}`, color: `#${d.text_color}`,
        minWidth: 22, textAlign: 'center', borderRadius: 5,
        fontSize: 11, fontWeight: 800, padding: '3px 5px', flexShrink: 0,
      }}>{d.route}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 11, color: 'rgba(255,255,255,0.85)', fontWeight: 500,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{d.headsign || '—'}</div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>{d.time}</div>
        <div style={{
          fontSize: 9, fontWeight: 700, lineHeight: 1.3,
          color: soon ? '#34d399' : 'rgba(255,255,255,0.4)',
        }}>{d.in_min <= 0 ? 'in arrivo' : `${d.in_min} min`}</div>
      </div>
    </div>
  );
}

function BusStopPopup({ feature, schedule, status, refTime, onTimeChange }: {
  feature: MobilityFeature;
  schedule: StopSchedule | null;
  status: 'idle' | 'loading' | 'error';
  refTime: string;
  onTimeChange: (t: string) => void;
}) {
  const nome = String(feature.properties.nome || 'Fermata bus');
  const code = String(feature.properties.code || '');
  const routes = String(feature.properties.routes || '');
  const timeValue = refTime || schedule?.time || '';
  const kind = stopKind(feature);
  const color = busColor(kind);

  return (
    <div style={{ padding: '14px 16px 12px', minWidth: 250, maxWidth: 290 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9, paddingRight: 18 }}>
        <div style={{
          width: 30, height: 30, borderRadius: '50%',
          background: color + '22', border: `1.5px solid ${color}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0,
        }}>
          🚏
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#fff', lineHeight: 1.2 }}>{nome}</div>
          <div style={{ fontSize: 10, color, marginTop: 2, fontWeight: 600 }}>
            Fermata {busKindLabel(kind).toLowerCase()}{code ? ` · ${code}` : ''}
          </div>
        </div>
      </div>

      {/* Lines serving this stop */}
      {routes && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
          {routes.split(/\s+/).filter(Boolean).slice(0, 14).map((r) => (
            <span key={r} style={{
              background: color + '1e', border: `1px solid ${color}4d`,
              borderRadius: 5, padding: '1px 6px', fontSize: 9, fontWeight: 700, color,
            }}>{r}</span>
          ))}
        </div>
      )}

      {/* Time control */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, marginTop: 10,
        borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 10,
      }}>
        <span style={{
          flex: 1, fontSize: 9, color: 'rgba(255,255,255,0.45)',
          letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 700,
        }}>Prossime corse</span>
        <input
          type="time"
          value={timeValue}
          onChange={(e) => onTimeChange(e.target.value)}
          style={{
            background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: 6, color: '#fff', fontSize: 11, fontWeight: 600,
            padding: '3px 6px', outline: 'none', colorScheme: 'dark',
          }}
        />
      </div>

      {/* Departures */}
      <div style={{ maxHeight: 240, overflowY: 'auto' }}>
        {status === 'loading' && <div style={dimStyle}>Caricamento orari…</div>}
        {status === 'error' && <div style={dimStyle}>Orari non disponibili</div>}
        {status === 'idle' && schedule && schedule.departures.length === 0 && (
          <div style={dimStyle}>Nessuna corsa in programma</div>
        )}
        {status === 'idle' && schedule?.departures.map((d, i) => (
          <DepartureRow key={i} d={d} />
        ))}
      </div>
    </div>
  );
}

function BusVehiclePopup({ bus }: { bus: BusVehicle }) {
  const color = busColor(bus.kind);
  const live = bus.live;
  const delay = bus.delay ?? 0;
  const onTime = delay <= 0;
  const delayColor = onTime ? '#34d399' : delay <= 3 ? '#fbbf24' : '#f87171';
  const delayText = onTime ? 'In orario' : `+${delay} min`;
  const muted = 'rgba(255,255,255,0.5)';
  return (
    <div style={{ padding: '14px 18px 12px', minWidth: 180 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8, paddingRight: 18 }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%',
          background: color, border: '2px solid rgba(255,255,255,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, fontWeight: 800, color: '#fff', flexShrink: 0,
        }}>
          {bus.route}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#fff' }}>Linea {bus.route}</div>
          <div style={{ fontSize: 11, color, marginTop: 2, fontWeight: 600 }}>Bus {busKindLabel(bus.kind)}</div>
        </div>
      </div>
      {bus.headsign && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '5px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Destinazione</span>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', fontWeight: 600, textAlign: 'right' }}>{bus.headsign}</span>
        </div>
      )}
      {live && (
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Ritardo</span>
          <span style={{ fontSize: 11, color: delayColor, fontWeight: 700 }}>{delayText}</span>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Velocità {live ? '' : 'media'}</span>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', fontWeight: 600 }}>{bus.speed} km/h</span>
      </div>
      <div style={{
        marginTop: 10,
        padding: '6px 0',
        textAlign: 'center',
        borderRadius: 8,
        background: live ? color + '26' : 'rgba(255,255,255,0.06)',
        border: `1px solid ${live ? color + '4d' : 'rgba(255,255,255,0.14)'}`,
        fontSize: 11, fontWeight: 700, color: live ? color : muted,
      }}>
        {live ? '● In tempo reale' : '○ Posizione stimata da orario'}
      </div>
    </div>
  );
}

// ── Layer components ───────────────────────────────────────────────────────────

function PointMarkers({ features, category, onSelect, onNavigate }: {
  features: MobilityFeature[];
  category: CategoryKey;
  onSelect: (f: MobilityFeature, c: CategoryKey) => void;
  onNavigate?: (f: MobilityFeature, c: CategoryKey) => void;
}) {
  const icon = createPointIcon(category);
  return (
    <>
      {features.map((f, i) => {
        const coords = f.geometry.coordinates as number[];
        return (
          <Marker key={i} position={[coords[1], coords[0]]} icon={icon}
            eventHandlers={{ click: () => onSelect(f, category) }}>
            <Popup closeButton>
              <FeaturePopup feature={f} category={category} onNavigate={onNavigate} />
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}

function ParkingZones({ features, onSelect, onNavigate }: {
  features: MobilityFeature[];
  onSelect: (f: MobilityFeature, c: CategoryKey) => void;
  onNavigate?: (f: MobilityFeature, c: CategoryKey) => void;
}) {
  const color = CategoryColors.parking;
  return (
    <>
      {features.map((f, i) => {
        const positions = (f.geometry.coordinates as number[][][])[0].map(
          (c) => [c[1], c[0]] as [number, number]
        );
        return (
          <Polygon key={i} positions={positions}
            pathOptions={{ fillColor: color, fillOpacity: 0.12, color, weight: 1.5, opacity: 0.6 }}
            eventHandlers={{ click: () => onSelect(f, 'parking') }}>
            <Popup closeButton>
              <FeaturePopup feature={f} category="parking" onNavigate={onNavigate} />
            </Popup>
          </Polygon>
        );
      })}
    </>
  );
}

// A single bus stop. Its GTFS departure board is fetched lazily — only when
// the stop is clicked — so opening the map doesn't fire a request per stop.
function BusStopMarker({ feature }: { feature: MobilityFeature }) {
  const coords = feature.geometry.coordinates as number[];
  const stopId = String(feature.properties.stop_id ?? '');
  const color = busColor(stopKind(feature));

  const [schedule, setSchedule] = useState<StopSchedule | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [refTime, setRefTime] = useState('');
  const reqId = useRef(0);

  const load = useCallback((time: string) => {
    if (!stopId) { setStatus('error'); return; }
    const id = ++reqId.current;
    setStatus('loading');
    const q = time ? `?time=${encodeURIComponent(time)}` : '';
    fetch(`${API_BASE}/api/busstops/${encodeURIComponent(stopId)}/schedule${q}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http'))))
      .then((d: StopSchedule) => {
        if (id !== reqId.current) return;
        setSchedule(d);
        setStatus('idle');
      })
      .catch(() => {
        if (id === reqId.current) setStatus('error');
      });
  }, [stopId]);

  const handleTimeChange = useCallback((t: string) => {
    setRefTime(t);
    load(t);
  }, [load]);

  return (
    <CircleMarker
      center={[coords[1], coords[0]]}
      radius={7}
      pane="cs-bus-stops"
      pathOptions={{
        fillColor: color, fillOpacity: 0.85,
        color, weight: 1.5, opacity: 0.9,
      }}
      eventHandlers={{
        click: () => {
          if (!schedule && status !== 'loading') load(refTime);
        },
      }}
    >
      <Popup
        closeButton
        minWidth={250}
        pane="popupPane"
        autoPanPaddingTopLeft={[238, 16]}
        autoPanPaddingBottomRight={[150, 16]}
      >
        <BusStopPopup
          feature={feature}
          schedule={schedule}
          status={status}
          refTime={refTime}
          onTimeChange={handleTimeChange}
        />
      </Popup>
    </CircleMarker>
  );
}

// ── Bus stop clustering + viewport culling ──────────────────────────────────────

const STOP_INDIVIDUAL_ZOOM = 15;  // at/above this zoom every visible stop is shown
const CLUSTER_CELL_PX = 70;       // grid cell size (screen px) used to group stops
const VIEWPORT_PAD = 0.3;         // render this far beyond the viewport for smooth pans
const MAX_BUSES = 280;            // hard cap on rendered bus markers (perf ceiling)

// Re-renders its consumer whenever the map finishes moving or zooming.
function useMapViewport() {
  const map = useMap();
  const [view, setView] = useState(() => ({ bounds: map.getBounds(), zoom: map.getZoom() }));
  useEffect(() => {
    const update = () => setView({ bounds: map.getBounds(), zoom: map.getZoom() });
    map.on('moveend zoomend', update);
    return () => { map.off('moveend zoomend', update); };
  }, [map]);
  return view;
}

function clusterIcon(count: number, kind: BusKind) {
  const color = busColor(kind);
  const size = count < 10 ? 30 : count < 50 ? 38 : count < 200 ? 46 : 54;
  return L.divIcon({
    className: '',
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:${color}d9;border:2px solid ${color};
      box-shadow:0 0 16px ${color}55,0 2px 10px rgba(0,0,0,0.6);
      display:flex;align-items:center;justify-content:center;
      color:#fff;font-weight:800;font-size:12px;cursor:pointer;
    ">${count}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

interface Cluster { lat: number; lng: number; count: number; }

// Viewport-culled, grid-clustered bus stops: off-screen stops are skipped, and
// when zoomed out nearby stops collapse into a single counted bubble — so the
// DOM stays small no matter how many stops the dataset contains.
function BusStopsLayer({ features, kind }: { features: MobilityFeature[]; kind: BusKind }) {
  const map = useMap();
  const { bounds, zoom } = useMapViewport();

  const { individuals, clusters } = useMemo(() => {
    const padded = bounds.pad(VIEWPORT_PAD);
    const visible = features.filter((f) => {
      const c = f.geometry.coordinates as number[];
      return padded.contains([c[1], c[0]]);
    });

    if (zoom >= STOP_INDIVIDUAL_ZOOM) {
      return { individuals: visible, clusters: [] as Cluster[] };
    }

    // Bucket visible stops into a fixed pixel grid at the current zoom.
    const cells = new Map<string, MobilityFeature[]>();
    for (const f of visible) {
      const c = f.geometry.coordinates as number[];
      const p = map.project([c[1], c[0]], zoom);
      const key = `${Math.floor(p.x / CLUSTER_CELL_PX)}:${Math.floor(p.y / CLUSTER_CELL_PX)}`;
      const cell = cells.get(key);
      if (cell) cell.push(f);
      else cells.set(key, [f]);
    }

    const individuals: MobilityFeature[] = [];
    const clusters: Cluster[] = [];
    for (const group of cells.values()) {
      if (group.length === 1) {
        individuals.push(group[0]);
        continue;
      }
      let lat = 0, lng = 0;
      for (const f of group) {
        const c = f.geometry.coordinates as number[];
        lat += c[1];
        lng += c[0];
      }
      clusters.push({ lat: lat / group.length, lng: lng / group.length, count: group.length });
    }
    return { individuals, clusters };
  }, [features, bounds, zoom, map]);

  return (
    <>
      {clusters.map((cl) => (
        <Marker
          key={`${cl.lat.toFixed(5)}:${cl.lng.toFixed(5)}`}
          position={[cl.lat, cl.lng]}
          icon={clusterIcon(cl.count, kind)}
          pane="cs-bus-stops"
          eventHandlers={{
            click: () => map.flyTo([cl.lat, cl.lng], Math.min(zoom + 2, STOP_INDIVIDUAL_ZOOM)),
          }}
        />
      ))}
      {individuals.map((f, i) => (
        <BusStopMarker key={String(f.properties.stop_id ?? i)} feature={f} />
      ))}
    </>
  );
}

interface RouteLine { coords: [number, number][]; kind: BusKind; }

function LiveBusLayer({ vehicles }: { vehicles: BusVehicle[] }) {
  // react-leaflet calls setIcon (recreating the DOM node) whenever the `icon`
  // prop changes by reference — which would kill the CSS glide transition.
  // Cache icons by bus + bearing bucket so the marker element persists across
  // polls and `.cs-bus-marker { transition: transform }` can animate position.
  const iconCache = useRef<Map<string, L.DivIcon>>(new Map());
  const map = useMap();
  const { bounds } = useMapViewport();
  const [routeLine, setRouteLine] = useState<RouteLine | null>(null);
  const routeReq = useRef(0);

  // Cull off-screen buses, then hard-cap the rest: when zoomed out the whole
  // fleet is in view, so keep the live buses and the ones nearest the centre.
  const visible = useMemo(() => {
    const padded = bounds.pad(VIEWPORT_PAD);
    const inView = vehicles.filter((b) => padded.contains([b.lat, b.lon]));
    if (inView.length <= MAX_BUSES) return inView;
    const c = bounds.getCenter();
    return inView
      .map((b) => ({ b, d: (b.lat - c.lat) ** 2 + (b.lon - c.lng) ** 2 }))
      .sort((x, y) => (Number(y.b.live) - Number(x.b.live)) || (x.d - y.d))
      .slice(0, MAX_BUSES)
      .map((e) => e.b);
  }, [vehicles, bounds]);

  // Tapping the map background dismisses the route preview (marker clicks
  // don't bubble to the map, so switching buses never triggers this).
  useEffect(() => {
    const clear = () => { routeReq.current++; setRouteLine(null); };
    map.on('click', clear);
    return () => { map.off('click', clear); };
  }, [map]);

  const showRoute = useCallback((bus: BusVehicle) => {
    const tripId = bus.id.replace(/^trip-/, '');
    const id = ++routeReq.current;
    fetch(`${API_BASE}/api/buses/${encodeURIComponent(tripId)}/route`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http'))))
      .then((d: { geometry?: { coordinates?: number[][] } }) => {
        if (id !== routeReq.current) return;
        const coords = (d.geometry?.coordinates ?? []).map(
          (c) => [c[1], c[0]] as [number, number],
        );
        setRouteLine(coords.length >= 2 ? { coords, kind: bus.kind } : null);
      })
      .catch(() => { if (id === routeReq.current) setRouteLine(null); });
  }, []);

  return (
    <>
      {routeLine && (
        <Pane name="cs-route" style={{ zIndex: 535 }}>
          <Polyline
            positions={routeLine.coords}
            pane="cs-route"
            interactive={false}
            pathOptions={{ color: busColor(routeLine.kind), weight: 9, opacity: 0.18 }}
          />
          <Polyline
            positions={routeLine.coords}
            pane="cs-route"
            interactive={false}
            pathOptions={{
              color: busColor(routeLine.kind),
              weight: 3.5,
              opacity: 0.95,
              dashArray: '14 14',
              className: `cs-route-line ${routeLine.kind === 'extraurban' ? 'cs-route-extra' : 'cs-route-urban'}`,
            }}
          />
        </Pane>
      )}
      {visible.map((bus) => {
        const bucket = Math.round(bus.bearing / 15) * 15;
        const cacheKey = `${bus.id}:${bus.route}:${bus.kind}:${bus.live}:${bucket}`;
        let icon = iconCache.current.get(cacheKey);
        if (!icon) {
          icon = createBusVehicleIcon(bus.route, bucket, bus.kind, bus.live);
          iconCache.current.set(cacheKey, icon);
        }
        return (
          <Marker
            key={bus.id}
            position={[bus.lat, bus.lon]}
            icon={icon}
            eventHandlers={{ click: () => showRoute(bus) }}
          >
            <Popup closeButton>
              <BusVehiclePopup bus={bus} />
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}

// ── Live user location ──────────────────────────────────────────────────────────

function createUserIcon() {
  return L.divIcon({
    className: '',
    html: `<div class="cs-user-dot">
      <div class="cs-user-dot-pulse"></div>
      <div class="cs-user-dot-core"></div>
    </div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

// Renders the live position dot + GPS accuracy halo. Flies the map to the user
// on the first fix, and again whenever `recenterNonce` changes (locate button
// pressed while already tracking).
function UserLocationLayer({ location, recenterNonce }: {
  location: LiveLocation;
  recenterNonce: number;
}) {
  const map = useMap();
  const icon = useMemo(createUserIcon, []);
  const didFirstFix = useRef(false);
  const lastRecenter = useRef(recenterNonce);

  useEffect(() => {
    if (!didFirstFix.current) {
      didFirstFix.current = true;
      map.flyTo([location.lat, location.lng], Math.max(map.getZoom(), 16), { duration: 1.2 });
    }
  }, [location, map]);

  useEffect(() => {
    if (recenterNonce !== lastRecenter.current) {
      lastRecenter.current = recenterNonce;
      map.flyTo([location.lat, location.lng], Math.max(map.getZoom(), 16), { duration: 0.8 });
    }
  }, [recenterNonce, location, map]);

  return (
    <Pane name="cs-user-loc" style={{ zIndex: 560 }}>
      <Circle
        center={[location.lat, location.lng]}
        radius={location.accuracy}
        pane="cs-user-loc"
        interactive={false}
        pathOptions={{
          color: '#3b82f6', weight: 1, opacity: 0.45,
          fillColor: '#3b82f6', fillOpacity: 0.1,
        }}
      />
      <Marker
        position={[location.lat, location.lng]}
        icon={icon}
        pane="cs-user-loc"
        interactive={false}
      />
    </Pane>
  );
}

// Floating glass control that requests / re-centres on the live location.
function LocateButton({ status, onPress }: {
  status: LocationStatus;
  onPress: () => void;
}) {
  const locating = status === 'locating';
  const tracking = status === 'tracking';
  const isError  = status === 'error';
  const accent   = isError ? '#f87171' : tracking ? '#3b82f6' : 'rgba(255,255,255,0.88)';
  const title = isError
    ? 'Posizione non disponibile — riprova'
    : tracking
    ? 'Centra sulla mia posizione'
    : 'Mostra la mia posizione';

  return (
    <div
      onClick={onPress}
      title={title}
      style={{
        // bottom = zoom-bar height (94) + leaflet margin (10) + gap (16) = 120
        position: 'absolute', right: 10, bottom: 120, zIndex: 1000,
        width: 44, height: 44, borderRadius: 16,
        background: 'rgba(18,18,20,0.55)',
        backdropFilter: 'blur(22px) saturate(180%)',
        WebkitBackdropFilter: 'blur(22px) saturate(180%)',
        border: `1px solid ${tracking || isError ? accent + '66' : 'rgba(255,255,255,0.14)'}`,
        boxShadow: '0 8px 28px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.12)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', userSelect: 'none',
        transition: 'background 0.15s ease, border-color 0.15s ease',
      }}
    >
      {locating ? (
        <div style={{
          width: 18, height: 18, borderRadius: '50%',
          border: '2px solid rgba(255,255,255,0.2)', borderTopColor: '#3b82f6',
          animation: 'cs-locate-spin 0.8s linear infinite',
        }} />
      ) : tracking ? (
        /* Tracking: filled target — "re-centre on me" */
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="9" cy="9" r="5.5" stroke={accent} strokeWidth="1.7"/>
          <circle cx="9" cy="9" r="2.2" fill={accent}/>
          <path d="M9 1.5V3.5M9 14.5V16.5M1.5 9H3.5M14.5 9H16.5"
            stroke={accent} strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      ) : (
        /* Idle/error: location pin — "find me" */
        <svg width="14" height="18" viewBox="0 0 14 18" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M7 0C3.13 0 0 3.13 0 7C0 12.25 7 18 7 18C7 18 14 12.25 14 7C14 3.13 10.87 0 7 0Z"
            fill={accent}/>
          <circle cx="7" cy="7" r="2.6" fill="rgba(13,14,20,0.85)"/>
        </svg>
      )}
    </div>
  );
}

// Floating glass control that opens the routing / directions panel.
function RouteButton({ onPress }: { onPress: () => void }) {
  return (
    <div
      onClick={onPress}
      title="Indicazioni"
      style={{
        position: 'absolute', right: 10, bottom: 146, zIndex: 1000,
        width: 42, height: 42, borderRadius: 12,
        background: 'rgba(16,17,23,0.62)',
        backdropFilter: 'blur(28px) saturate(180%)',
        WebkitBackdropFilter: 'blur(28px) saturate(180%)',
        border: '1px solid rgba(255,255,255,0.16)',
        boxShadow: '0 8px 28px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.12)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', userSelect: 'none', fontSize: 19,
      }}
    >🧭</div>
  );
}

// ── Multimodal route overlay ────────────────────────────────────────────────────

function createDestIcon() {
  return L.divIcon({
    className: '',
    html: `<div style="position:relative;width:30px;height:38px;">
      <div style="
        position:absolute;left:3px;top:0;width:24px;height:24px;
        background:#ec4899;border:2.5px solid #fff;
        border-radius:50% 50% 50% 0;transform:rotate(-45deg);
        box-shadow:0 4px 12px rgba(0,0,0,0.6);
      "></div>
      <div style="
        position:absolute;left:11px;top:8px;width:8px;height:8px;
        background:#fff;border-radius:50%;
      "></div>
    </div>`,
    iconSize: [30, 38],
    iconAnchor: [15, 32],
    popupAnchor: [0, -34],
  });
}

// Frames the whole itinerary in view, leaving room for the routing panel
// that sits over the top-left of the map. Fits only when the destination
// changes — live re-routes to the same destination won't jolt the map.
function FitRoute({ route }: { route: RouteSuggestion }) {
  const map = useMap();
  const dest = route.legs[route.legs.length - 1]?.to;
  const destKey = dest ? `${dest.lat.toFixed(5)},${dest.lng.toFixed(5)}` : '';
  useEffect(() => {
    const pts: [number, number][] = [];
    for (const leg of route.legs) {
      for (const [lng, lat] of leg.polyline) pts.push([lat, lng]);
    }
    if (pts.length >= 2) {
      map.fitBounds(pts, {
        paddingTopLeft: [388, 80],
        paddingBottomRight: [80, 110],
        maxZoom: 16,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destKey, map]);
  return null;
}

// Draws the selected itinerary: one polyline per leg (walking legs dotted),
// a white transfer dot at each mode change, and a pin at the destination.
function RouteLayer({ route }: { route: RouteSuggestion }) {
  const dest = route.legs[route.legs.length - 1]?.to;
  const destIcon = useMemo(createDestIcon, []);
  if (!dest) return null;

  return (
    <>
      <FitRoute route={route} />
      <Pane name="cs-trip-route" style={{ zIndex: 545 }}>
        {route.legs.map((leg, i) => {
          const pts = leg.polyline.map(([lng, lat]) => [lat, lng] as [number, number]);
          const color = MODE_META[leg.mode].color;
          return (
            <React.Fragment key={i}>
              <Polyline
                positions={pts}
                pane="cs-trip-route"
                interactive={false}
                pathOptions={{ color, weight: 10, opacity: 0.16 }}
              />
              <Polyline
                positions={pts}
                pane="cs-trip-route"
                interactive={false}
                pathOptions={{
                  color,
                  weight: 4.5,
                  opacity: 0.95,
                  lineCap: 'round',
                  lineJoin: 'round',
                  dashArray: leg.mode === 'walk' ? '1 9' : undefined,
                }}
              />
            </React.Fragment>
          );
        })}
        {route.legs.slice(0, -1).map((leg, i) => (
          <CircleMarker
            key={`xfer-${i}`}
            center={[leg.to.lat, leg.to.lng]}
            radius={5.5}
            pane="cs-trip-route"
            interactive={false}
            pathOptions={{
              fillColor: '#fff', fillOpacity: 1,
              color: MODE_META[leg.mode].color, weight: 3,
            }}
          />
        ))}
      </Pane>
      <Marker position={[dest.lat, dest.lng]} icon={destIcon} interactive={false} />
    </>
  );
}

// ── Trains: railway line, stations and live vehicles ───────────────────────────

const RAIL_COLORS: Record<string, string> = {
  brennero: '#8b97b5',   // Verona–Bolzano main line
  ftm: '#d98a3a',        // Trento–Malè (Trentino Trasporti)
};
const RAIL_LABELS: Record<string, string> = {
  brennero: 'Linea del Brennero',
  ftm: 'Trento–Malè–Mezzana',
};

// Real OSM track alignment, drawn as a faint dashed line beneath everything.
function RailLayer({ rail }: { rail: RailCollection }) {
  return (
    <Pane name="cs-rail" style={{ zIndex: 405 }}>
      {rail.features.map((f, i) => {
        const pts = f.geometry.coordinates.map(
          ([lng, lat]) => [lat, lng] as [number, number],
        );
        const color = RAIL_COLORS[f.properties.line] ?? '#8b97b5';
        return (
          <React.Fragment key={i}>
            <Polyline positions={pts} pane="cs-rail" interactive={false}
              pathOptions={{ color, weight: 6, opacity: 0.12 }} />
            <Polyline positions={pts} pane="cs-rail" interactive={false}
              pathOptions={{ color, weight: 1.7, opacity: 0.65, dashArray: '2 5' }} />
          </React.Fragment>
        );
      })}
    </Pane>
  );
}

// One carriage of a train, top-down. Front = top (North = 0°). The leading
// carriage is drawn as a locomotive — a cab windscreen, plus a tapered
// aerodynamic nose for high-speed services; the rest are plain coaches.
function carriageSvg(color: string, len: number, w: number, locoFast: boolean, isLoco: boolean): string {
  const vw = Math.max(8, Math.round(w * 2));
  const vl = Math.max(10, Math.round(len * 2));
  const rx = Math.min(5, vw / 3);
  const ins = 1.6;
  let body: string;
  if (locoFast) {
    const nose = Math.min(vl * 0.42, vw * 1.1);
    body = `M${vw / 2} ${ins} `
      + `C${vw * 0.2} ${ins} ${ins} ${nose * 0.5} ${ins} ${nose} `
      + `L${ins} ${vl - rx} Q${ins} ${vl - ins} ${ins + rx} ${vl - ins} `
      + `L${vw - ins - rx} ${vl - ins} Q${vw - ins} ${vl - ins} ${vw - ins} ${vl - rx} `
      + `L${vw - ins} ${nose} C${vw - ins} ${nose * 0.5} ${vw * 0.8} ${ins} ${vw / 2} ${ins} Z`;
  } else {
    body = `M${ins + rx} ${ins} L${vw - ins - rx} ${ins} `
      + `Q${vw - ins} ${ins} ${vw - ins} ${ins + rx} L${vw - ins} ${vl - rx} `
      + `Q${vw - ins} ${vl - ins} ${vw - ins - rx} ${vl - ins} L${ins + rx} ${vl - ins} `
      + `Q${ins} ${vl - ins} ${ins} ${vl - rx} L${ins} ${ins + rx} Q${ins} ${ins} ${ins + rx} ${ins} Z`;
  }
  const winW = Math.max(1.3, vw * 0.16);
  const winY = locoFast ? vl * 0.42 : vl * 0.2;
  const winH = locoFast ? vl * 0.4 : vl * 0.6;
  const windows = `
    <rect x="${ins + 0.7}" y="${winY}" width="${winW}" height="${winH}" rx="${winW / 2}" fill="rgba(255,255,255,0.24)"/>
    <rect x="${vw - ins - 0.7 - winW}" y="${winY}" width="${winW}" height="${winH}" rx="${winW / 2}" fill="rgba(255,255,255,0.24)"/>`;
  const windshield = isLoco
    ? `<rect x="${vw * 0.27}" y="${locoFast ? vl * 0.18 : ins + 1.2}" width="${vw * 0.46}" height="${Math.max(2.4, vw * 0.42)}" rx="2" fill="rgba(255,255,255,0.36)"/>`
    : '';
  // Dark seams at the coach ends so adjacent carriages read as separate units.
  const seam = `<rect x="${ins}" y="${vl - 2.2}" width="${vw - ins * 2}" height="1.5" rx="0.7" fill="rgba(0,0,0,0.34)"/>`
    + (isLoco ? '' : `<rect x="${ins}" y="0.7" width="${vw - ins * 2}" height="1.5" rx="0.7" fill="rgba(0,0,0,0.34)"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w)}" height="${Math.round(len)}" viewBox="0 0 ${vw} ${vl}" fill="none">
    <path d="${body}" fill="${color}" stroke="rgba(255,255,255,0.3)" stroke-width="0.7"/>
    ${windows}${windshield}${seam}
  </svg>`;
}

function createCarriageIcon(train: TrainVehicle, isLoco: boolean, lenPx: number, bearing: number): L.DivIcon {
  const len = Math.round(lenPx);
  const w = Math.max(5, Math.min(20, Math.round(lenPx * 0.46)));
  const glow = isLoco && train.live
    ? `<div class="cs-train-glow" style="background:radial-gradient(closest-side, ${train.color}cc, ${train.color}00);"></div>`
    : '';
  const size = Math.max(len, w) + (isLoco && train.live ? 20 : 4);
  return L.divIcon({
    className: 'cs-train-marker',
    html: `<div class="cs-train-wrap${train.live ? '' : ' ghost'}" style="width:${size}px;height:${size}px;">
      ${glow}
      <div class="cs-train-rot" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(${bearing}deg);">
        ${carriageSvg(train.color, len, w, isLoco && train.fast, isLoco)}
      </div>
    </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -(len / 2) - 4],
  });
}

function createTrainStationIcon() {
  const c = TrainStationColor;
  return L.divIcon({
    className: '',
    html: `<div style="
      width:34px;height:34px;border-radius:10px;
      background:${c}26;border:2.5px solid ${c};
      display:flex;align-items:center;justify-content:center;font-size:16px;cursor:pointer;
      box-shadow:0 0 16px ${c}55,0 2px 8px rgba(0,0,0,0.5);
    ">🚉</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -20],
  });
}

function TrainBoardRow({ d }: { d: TrainBoard['departures'][number] }) {
  const onTime = d.delay <= 0;
  const delayColor = onTime ? '#34d399' : d.delay <= 5 ? '#fbbf24' : '#f87171';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 9, padding: '7px 0',
      borderTop: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div style={{ flexShrink: 0, width: 38, textAlign: 'center' }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: '#fff', lineHeight: 1.1 }}>{d.time}</div>
        <div style={{ fontSize: 8.5, fontWeight: 700, color: delayColor, lineHeight: 1.3 }}>
          {onTime ? 'in orario' : `+${d.delay}′`}
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{
          background: d.color, color: '#fff', borderRadius: 4,
          fontSize: 9, fontWeight: 800, padding: '2px 5px',
        }}>{d.number}</span>
        <div style={{
          fontSize: 11, color: 'rgba(255,255,255,0.82)', fontWeight: 500, marginTop: 3,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>→ {d.destination}</div>
      </div>
      <div style={{ flexShrink: 0, textAlign: 'center', minWidth: 30 }}>
        <div style={{
          fontSize: 8, color: 'rgba(255,255,255,0.4)', fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.04em',
        }}>Bin</div>
        <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', lineHeight: 1.1 }}>
          {d.platform || '—'}
        </div>
      </div>
    </div>
  );
}

function TrainStationPopup({ feature, board, status, refTime, onTimeChange }: {
  feature: MobilityFeature;
  board: TrainBoard | null;
  status: 'idle' | 'loading' | 'error';
  refTime: string;
  onTimeChange: (t: string) => void;
}) {
  const name = String(feature.properties.name || 'Stazione');
  const nameDe = String(feature.properties.name_de || '');
  const line = String(feature.properties.line || '');
  const color = TrainStationColor;
  const timeValue = refTime || board?.time || '';

  return (
    <div style={{ padding: '14px 16px 12px', minWidth: 268, maxWidth: 300 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9, paddingRight: 18 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 9,
          background: color + '22', border: `1.5px solid ${color}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0,
        }}>🚉</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#fff', lineHeight: 1.2 }}>
            {name}{nameDe ? ` · ${nameDe}` : ''}
          </div>
          <div style={{ fontSize: 10, color, marginTop: 2, fontWeight: 600 }}>
            {RAIL_LABELS[line] ?? 'Stazione ferroviaria'}
          </div>
        </div>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, marginTop: 4,
        borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 10,
      }}>
        <span style={{
          flex: 1, fontSize: 9, color: 'rgba(255,255,255,0.45)',
          letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 700,
        }}>Treni in partenza</span>
        <input
          type="time"
          value={timeValue}
          onChange={(e) => onTimeChange(e.target.value)}
          style={{
            background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: 6, color: '#fff', fontSize: 11, fontWeight: 600,
            padding: '3px 6px', outline: 'none', colorScheme: 'dark',
          }}
        />
      </div>

      <div style={{ maxHeight: 256, overflowY: 'auto' }}>
        {status === 'loading' && <div style={dimStyle}>Caricamento orari…</div>}
        {status === 'error' && <div style={dimStyle}>Orari non disponibili</div>}
        {status === 'idle' && board && board.departures.length === 0 && (
          <div style={dimStyle}>Nessun treno in programma</div>
        )}
        {status === 'idle' && board?.departures.map((d, i) => (
          <TrainBoardRow key={i} d={d} />
        ))}
      </div>
    </div>
  );
}

// A train station. Its departure board (real ViaggiaTreno data for the
// Brennero line) is fetched lazily, only when the station is clicked.
function TrainStationMarker({ feature, icon }: {
  feature: MobilityFeature;
  icon: L.DivIcon;
}) {
  const coords = feature.geometry.coordinates as number[];
  const code = String(feature.properties.code ?? '');

  const [board, setBoard] = useState<TrainBoard | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [refTime, setRefTime] = useState('');
  const reqId = useRef(0);

  const load = useCallback((time: string) => {
    if (!code) { setStatus('error'); return; }
    const id = ++reqId.current;
    setStatus('loading');
    const q = time ? `?time=${encodeURIComponent(time)}` : '';
    fetch(`${API_BASE}/api/trainstations/${encodeURIComponent(code)}/board${q}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http'))))
      .then((d: TrainBoard) => {
        if (id !== reqId.current) return;
        setBoard(d);
        setStatus('idle');
      })
      .catch(() => { if (id === reqId.current) setStatus('error'); });
  }, [code]);

  const handleTimeChange = useCallback((t: string) => {
    setRefTime(t);
    load(t);
  }, [load]);

  return (
    <Marker
      position={[coords[1], coords[0]]}
      icon={icon}
      pane="cs-train-stations"
      eventHandlers={{
        click: () => { if (!board && status !== 'loading') load(refTime); },
      }}
    >
      <Popup
        closeButton
        minWidth={268}
        autoPanPaddingTopLeft={[256, 16]}
        autoPanPaddingBottomRight={[150, 16]}
      >
        <TrainStationPopup
          feature={feature}
          board={board}
          status={status}
          refTime={refTime}
          onTimeChange={handleTimeChange}
        />
      </Popup>
    </Marker>
  );
}

function TrainStationsLayer({ features }: { features: MobilityFeature[] }) {
  const icon = useMemo(createTrainStationIcon, []);
  return (
    <Pane name="cs-train-stations" style={{ zIndex: 552 }}>
      {features.map((f, i) => (
        <TrainStationMarker key={String(f.properties.code ?? i)} feature={f} icon={icon} />
      ))}
    </Pane>
  );
}

function TrainVehiclePopup({ train }: { train: TrainVehicle }) {
  const live = train.live;
  const onTime = train.delay <= 0;
  const delayColor = onTime ? '#34d399' : train.delay <= 5 ? '#fbbf24' : '#f87171';
  const muted = 'rgba(255,255,255,0.5)';
  const rows: [string, string, string?][] = [
    ['Destinazione', train.headsign || '—'],
    ...(live ? [['Ritardo', onTime ? 'In orario' : `+${train.delay} min`, delayColor] as [string, string, string]] : []),
    ['Velocità', `${train.speed} km/h`],
    ['Composizione', `${train.cars} carrozze · ${train.lengthM} m`],
  ];
  return (
    <div style={{ padding: '14px 18px 12px', minWidth: 210 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, paddingRight: 18 }}>
        <div style={{
          minWidth: 44, height: 30, borderRadius: 7, padding: '0 8px',
          background: train.color, border: '2px solid rgba(255,255,255,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 800, color: '#fff', flexShrink: 0,
        }}>{train.number}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, color: '#fff' }}>{train.brandLabel}</div>
          <div style={{ fontSize: 11, color: train.color, marginTop: 2, fontWeight: 600 }}>
            {train.fast ? 'Alta velocità / lunga percorrenza' : 'Servizio regionale'}
          </div>
        </div>
      </div>
      {rows.map(([k, v, c]) => (
        <div key={k} style={{
          display: 'flex', justifyContent: 'space-between', gap: 12,
          padding: '5px 0', borderTop: '1px solid rgba(255,255,255,0.06)',
        }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{k}</span>
          <span style={{ fontSize: 11, color: c ?? 'rgba(255,255,255,0.78)', fontWeight: 600, textAlign: 'right' }}>{v}</span>
        </div>
      ))}
      <div style={{
        marginTop: 10, padding: '6px 0', textAlign: 'center', borderRadius: 8,
        background: live ? train.color + '26' : 'rgba(255,255,255,0.06)',
        border: `1px solid ${live ? train.color + '4d' : 'rgba(255,255,255,0.14)'}`,
        fontSize: 11, fontWeight: 700, color: live ? train.color : muted,
      }}>
        {live ? '● In tempo reale' : '○ Posizione stimata da orario'}
      </div>
    </div>
  );
}

// Live trains — each rendered as a chain of carriage markers laid along the
// track. Carriage length is sized from the current zoom so the coaches stay
// coupled, and icons are cached so the CSS glide survives the 4 s polls.
function LiveTrainLayer({ trains }: { trains: TrainVehicle[] }) {
  const iconCache = useRef<Map<string, L.DivIcon>>(new Map());
  const { bounds, zoom } = useMapViewport();

  const visible = useMemo(() => {
    const padded = bounds.pad(VIEWPORT_PAD);
    return trains.filter((t) => padded.contains([t.lat, t.lon]));
  }, [trains, bounds]);

  return (
    <Pane name="cs-trains" style={{ zIndex: 606 }}>
      {visible.flatMap((train) => {
        // Real carriage length → on-screen pixels at the current zoom.
        const mPerPx = (156543.03 * Math.cos(train.lat * Math.PI / 180)) / 2 ** zoom;
        const carM = train.lengthM / Math.max(train.cars, 1);
        const lenPx = Math.max(8, Math.min(70, carM / mPerPx));
        const lenBucket = Math.round(lenPx);
        return train.carriages.map((car, idx) => {
          const isLoco = idx === 0;
          const bucket = Math.round(car.bearing / 12) * 12;
          const key = `${train.id}:${idx}:${isLoco}:${train.live}:${lenBucket}:${bucket}`;
          let icon = iconCache.current.get(key);
          if (!icon) {
            icon = createCarriageIcon(train, isLoco, lenPx, bucket);
            iconCache.current.set(key, icon);
          }
          return (
            <Marker
              key={`${train.id}-c${idx}`}
              position={[car.lat, car.lon]}
              icon={icon}
              pane="cs-trains"
            >
              <Popup closeButton>
                <TrainVehiclePopup train={train} />
              </Popup>
            </Marker>
          );
        });
      })}
    </Pane>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function MapView({
  data, busStops, busVehicles, trainStations, rail, trainVehicles,
  visibleCategories, selectedFeature,
  onFeatureSelect, onNavigate,
  userLocation, locationStatus = 'idle', recenterNonce = 0, onLocate,
  activeRoute, onOpenRouting, routingPanelOpen = false,
}: Props) {
  const showUrbanStops = visibleCategories.has('busstops_urban');
  const showExtraStops = visibleCategories.has('busstops_extraurban');
  const showTrainStations = visibleCategories.has('trainstations');
  const showTrains = visibleCategories.has('trains');
  // Memoised so the array identity is stable across the 3 s bus refreshes —
  // otherwise BusStopsLayer would re-cluster (and remount markers) every tick.
  const urbanStops = useMemo(
    () => (showUrbanStops ? busStops.features.filter((f) => stopKind(f) === 'urban') : []),
    [busStops, showUrbanStops],
  );
  const extraStops = useMemo(
    () => (showExtraStops ? busStops.features.filter((f) => stopKind(f) === 'extraurban') : []),
    [busStops, showExtraStops],
  );

  return (
    <View style={styles.container}>
      <MapContainer center={CENTER} zoom={14} style={{ width: '100%', height: '100%' }} zoomControl={false}>
        <StylesInjector />
        <TileLayer url={TILE_URL} attribution={TILE_ATTR} />
        <ZoomControl
          position="bottomright"
          zoomInText='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
          zoomOutText='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 8h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
        />

        {visibleCategories.has('stations') && (
          <PointMarkers features={data.stations.features} category="stations" onSelect={onFeatureSelect} onNavigate={onNavigate} />
        )}
        {visibleCategories.has('taxi') && (
          <PointMarkers features={data.taxi.features} category="taxi" onSelect={onFeatureSelect} onNavigate={onNavigate} />
        )}
        {visibleCategories.has('carsharing') && (
          <PointMarkers features={data.carsharing.features} category="carsharing" onSelect={onFeatureSelect} onNavigate={onNavigate} />
        )}
        {visibleCategories.has('parking') && (
          <ParkingZones features={data.parking.features} onSelect={onFeatureSelect} onNavigate={onNavigate} />
        )}
        {/* Bus stops live in their own pane above the overlay-pane (z 400) so
            the translucent parking polygons can't intercept stop clicks. */}
        {(showUrbanStops || showExtraStops) && (
          <Pane name="cs-bus-stops" style={{ zIndex: 550 }}>
            {showUrbanStops && <BusStopsLayer features={urbanStops} kind="urban" />}
            {showExtraStops && <BusStopsLayer features={extraStops} kind="extraurban" />}
          </Pane>
        )}
        {visibleCategories.has('buses') && (
          <LiveBusLayer vehicles={busVehicles} />
        )}
        {/* Railway track sits beneath the markers; shown with either rail layer. */}
        {(showTrainStations || showTrains) && <RailLayer rail={rail} />}
        {showTrainStations && (
          <TrainStationsLayer features={trainStations.features} />
        )}
        {showTrains && (
          <LiveTrainLayer trains={trainVehicles} />
        )}
        {userLocation && (
          <UserLocationLayer location={userLocation} recenterNonce={recenterNonce} />
        )}
        {activeRoute && <RouteLayer route={activeRoute} />}
      </MapContainer>
      {onLocate && <LocateButton status={locationStatus} onPress={onLocate} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
