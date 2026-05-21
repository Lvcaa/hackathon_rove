import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import {
  MapContainer, TileLayer, Marker, CircleMarker,
  Polygon, Popup, Pane, ZoomControl, useMap,
} from 'react-leaflet';
import L from 'leaflet';
import {
  MobilityData, MobilityFeature, MobilityCollection, CategoryKey,
  BusVehicle, BusKind, StopSchedule, Departure,
} from '../types/mobility';
import { CategoryColors, CategoryIcons, CategoryLabels } from '../constants/colors';

interface Props {
  data: MobilityData;
  busStops: MobilityCollection;
  busVehicles: BusVehicle[];
  visibleCategories: Set<CategoryKey>;
  selectedFeature: MobilityFeature | null;
  onFeatureSelect: (feature: MobilityFeature, category: CategoryKey) => void;
  onNavigate?: (feature: MobilityFeature, category: CategoryKey) => void;
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
    .leaflet-control-zoom a {
      background:rgba(17,17,17,0.9) !important; color:rgba(255,255,255,0.7) !important;
      border-color:rgba(255,255,255,0.1) !important;
    }
    .leaflet-control-zoom a:hover { background:rgba(30,30,30,0.95) !important; color:#fff !important; }
    .leaflet-bar { border:1px solid rgba(255,255,255,0.1) !important; border-radius:10px !important; overflow:hidden; box-shadow:0 4px 16px rgba(0,0,0,0.6) !important; }

    /* Live bus glow pulse — green for urban, blue for extraurban */
    @keyframes bus-glow-urban {
      0%   { filter: drop-shadow(0 0 5px rgba(118,184,42,0.55)) drop-shadow(0 2px 6px rgba(0,0,0,0.55)); }
      50%  { filter: drop-shadow(0 0 14px rgba(118,184,42,1.0)) drop-shadow(0 0 24px rgba(118,184,42,0.4)) drop-shadow(0 2px 6px rgba(0,0,0,0.55)); }
      100% { filter: drop-shadow(0 0 5px rgba(118,184,42,0.55)) drop-shadow(0 2px 6px rgba(0,0,0,0.55)); }
    }
    @keyframes bus-glow-extra {
      0%   { filter: drop-shadow(0 0 5px rgba(28,134,207,0.55)) drop-shadow(0 2px 6px rgba(0,0,0,0.55)); }
      50%  { filter: drop-shadow(0 0 14px rgba(28,134,207,1.0)) drop-shadow(0 0 24px rgba(28,134,207,0.4)) drop-shadow(0 2px 6px rgba(0,0,0,0.55)); }
      100% { filter: drop-shadow(0 0 5px rgba(28,134,207,0.55)) drop-shadow(0 2px 6px rgba(0,0,0,0.55)); }
    }
    .bus-vehicle-inner { display:inline-block; }
    .bus-vehicle-inner.urban { animation: bus-glow-urban 2.4s ease-in-out infinite; }
    .bus-vehicle-inner.extra { animation: bus-glow-extra 2.4s ease-in-out infinite; }

    /* Glide the marker between polled positions (matches BUS_REFRESH_MS).
       Suppressed during zoom so buses don't lag behind the map. */
    .cs-bus-marker { transition: transform 3s linear; }
    .leaflet-zoom-anim .cs-bus-marker { transition: none; }
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

function createBusVehicleIcon(route: string, bearing: number, kind: BusKind) {
  const glowClass = kind === 'extraurban' ? 'extra' : 'urban';
  return L.divIcon({
    className: 'cs-bus-marker',
    // Outer div carries the glow-pulse animation; inner div carries the rotation.
    // Separating them prevents the animation from interfering with position glide.
    html: `<div class="bus-vehicle-inner ${glowClass}">
      <div style="transform:rotate(${bearing}deg);transform-origin:13px 20px;line-height:0;">
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
  const delay = bus.delay ?? 0;
  const onTime = delay <= 0;
  const delayColor = onTime ? '#34d399' : delay <= 3 ? '#fbbf24' : '#f87171';
  const delayText = onTime ? 'In orario' : `+${delay} min`;
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
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Ritardo</span>
        <span style={{ fontSize: 11, color: delayColor, fontWeight: 700 }}>{delayText}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Velocità</span>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', fontWeight: 600 }}>{bus.speed} km/h</span>
      </div>
      <div style={{
        marginTop: 10,
        padding: '6px 0',
        textAlign: 'center',
        borderRadius: 8,
        background: color + '26',
        border: `1px solid ${color}4d`,
        fontSize: 11, fontWeight: 700, color,
      }}>
        ● In tempo reale
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

function LiveBusLayer({ vehicles }: { vehicles: BusVehicle[] }) {
  // react-leaflet calls setIcon (recreating the DOM node) whenever the `icon`
  // prop changes by reference — which would kill the CSS glide transition.
  // Cache icons by bus + bearing bucket so the marker element persists across
  // polls and `.cs-bus-marker { transition: transform }` can animate position.
  const iconCache = useRef<Map<string, L.DivIcon>>(new Map());

  return (
    <>
      {vehicles.map((bus) => {
        const bucket = Math.round(bus.bearing / 15) * 15;
        const cacheKey = `${bus.id}:${bus.route}:${bus.kind}:${bucket}`;
        let icon = iconCache.current.get(cacheKey);
        if (!icon) {
          icon = createBusVehicleIcon(bus.route, bucket, bus.kind);
          iconCache.current.set(cacheKey, icon);
        }
        return (
          <Marker key={bus.id} position={[bus.lat, bus.lon]} icon={icon}>
            <Popup closeButton>
              <BusVehiclePopup bus={bus} />
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function MapView({ data, busStops, busVehicles, visibleCategories, selectedFeature, onFeatureSelect, onNavigate }: Props) {
  const showUrbanStops = visibleCategories.has('busstops_urban');
  const showExtraStops = visibleCategories.has('busstops_extraurban');
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
        <ZoomControl position="bottomright" />

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
      </MapContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
