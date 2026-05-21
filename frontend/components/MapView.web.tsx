import React, { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import {
  MapContainer, TileLayer, Marker, CircleMarker,
  Polygon, Popup, useMap,
} from 'react-leaflet';
import L from 'leaflet';
import { MobilityData, MobilityFeature, MobilityCollection, CategoryKey, BusVehicle } from '../types/mobility';
import { CategoryColors, CategoryIcons, CategoryLabels } from '../constants/colors';

interface Props {
  data: MobilityData;
  busStops: MobilityCollection;
  busVehicles: BusVehicle[];
  visibleCategories: Set<CategoryKey>;
  selectedFeature: MobilityFeature | null;
  onFeatureSelect: (feature: MobilityFeature, category: CategoryKey) => void;
}

const TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
const CENTER: [number, number] = [46.072, 11.121];
const ORANGE = '#f97316';

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

    .leaflet-popup-content-wrapper {
      background:rgba(13,13,15,0.97) !important;
      backdrop-filter:blur(20px); -webkit-backdrop-filter:blur(20px);
      border:1px solid rgba(255,255,255,0.1) !important;
      border-radius:16px !important;
      box-shadow:0 16px 48px rgba(0,0,0,0.8) !important;
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

    /* Live bus glow pulse */
    @keyframes bus-glow-pulse {
      0%   { filter: drop-shadow(0 0 5px rgba(249,115,22,0.55)) drop-shadow(0 2px 6px rgba(0,0,0,0.55)); }
      50%  { filter: drop-shadow(0 0 14px rgba(249,115,22,1.0)) drop-shadow(0 0 24px rgba(249,115,22,0.4)) drop-shadow(0 2px 6px rgba(0,0,0,0.55)); }
      100% { filter: drop-shadow(0 0 5px rgba(249,115,22,0.55)) drop-shadow(0 2px 6px rgba(0,0,0,0.55)); }
    }
    .bus-vehicle-inner { animation: bus-glow-pulse 2.4s ease-in-out infinite; display:inline-block; }

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
function busSvg(route: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="62" viewBox="0 0 40 62" fill="none">
    <!-- Body -->
    <rect x="3" y="3" width="34" height="56" rx="9" fill="#f97316"/>
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

function createBusVehicleIcon(route: string, bearing: number) {
  return L.divIcon({
    className: 'cs-bus-marker',
    // Outer div carries the glow-pulse animation; inner div carries the rotation.
    // Separating them prevents the animation from interfering with position glide.
    html: `<div class="bus-vehicle-inner">
      <div style="transform:rotate(${bearing}deg);transform-origin:20px 31px;line-height:0;">
        ${busSvg(route)}
      </div>
    </div>`,
    iconSize: [40, 62],
    iconAnchor: [20, 31],   // center of bus body
    popupAnchor: [0, -32],
  });
}

// ── Popup content ──────────────────────────────────────────────────────────────

function getDisplayName(f: MobilityFeature): string {
  const p = f.properties;
  return String(p.nome || p.name || p.via || p.zona || p.descrizione || 'Posizione');
}

function FeaturePopup({ feature, category }: { feature: MobilityFeature; category: CategoryKey }) {
  const color = CategoryColors[category];
  const name = getDisplayName(feature);
  const pairs = Object.entries(feature.properties)
    .filter(([k]) => !['nome', 'name', 'zona'].includes(k) && feature.properties[k] !== null)
    .slice(0, 3);

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
      <div style={{
        marginTop: 12, background: color + '18', border: `1px solid ${color}44`,
        borderRadius: 8, padding: '8px 0', textAlign: 'center', cursor: 'pointer',
        fontSize: 12, fontWeight: 700, color, letterSpacing: '0.02em',
      }}>
        Naviga →
      </div>
    </div>
  );
}

function BusStopPopup({ feature }: { feature: MobilityFeature }) {
  const nome = String(feature.properties.nome || 'Fermata bus');
  const routes = String(feature.properties.routes || '');

  return (
    <div style={{ padding: '14px 18px 12px', minWidth: 180 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, paddingRight: 18 }}>
        <div style={{
          width: 30, height: 30, borderRadius: '50%',
          background: ORANGE + '22', border: `1.5px solid ${ORANGE}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0,
        }}>
          🚌
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#fff', lineHeight: 1.2 }}>{nome}</div>
          <div style={{ fontSize: 11, color: ORANGE, marginTop: 2, fontWeight: 600 }}>Fermata bus</div>
        </div>
      </div>
      {routes && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
          {routes.split(/[\s;,]+/).filter(Boolean).map((r) => (
            <span key={r} style={{
              background: ORANGE + '20', border: `1px solid ${ORANGE}55`,
              borderRadius: 5, padding: '2px 7px', fontSize: 10, fontWeight: 700, color: ORANGE,
            }}>{r}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function BusVehiclePopup({ bus }: { bus: BusVehicle }) {
  return (
    <div style={{ padding: '14px 18px 12px', minWidth: 180 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8, paddingRight: 18 }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%',
          background: ORANGE, border: '2px solid rgba(255,255,255,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, fontWeight: 800, color: '#fff', flexShrink: 0,
        }}>
          {bus.route}
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#fff' }}>Linea {bus.route}</div>
          <div style={{ fontSize: 11, color: ORANGE, marginTop: 2, fontWeight: 600 }}>Bus in servizio</div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Velocità</span>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', fontWeight: 600 }}>{bus.speed} km/h</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Direzione</span>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', fontWeight: 600 }}>{Math.round(bus.bearing)}°</span>
      </div>
      <div style={{
        marginTop: 10,
        padding: '6px 0',
        textAlign: 'center',
        borderRadius: 8,
        background: 'rgba(249,115,22,0.15)',
        border: '1px solid rgba(249,115,22,0.3)',
        fontSize: 11, fontWeight: 700, color: ORANGE,
      }}>
        ● In tempo reale
      </div>
    </div>
  );
}

// ── Layer components ───────────────────────────────────────────────────────────

function PointMarkers({ features, category, onSelect }: {
  features: MobilityFeature[];
  category: CategoryKey;
  onSelect: (f: MobilityFeature, c: CategoryKey) => void;
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
              <FeaturePopup feature={f} category={category} />
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}

function ParkingZones({ features, onSelect }: {
  features: MobilityFeature[];
  onSelect: (f: MobilityFeature, c: CategoryKey) => void;
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
              <FeaturePopup feature={f} category="parking" />
            </Popup>
          </Polygon>
        );
      })}
    </>
  );
}

function BusStopsLayer({ features }: { features: MobilityFeature[] }) {
  return (
    <>
      {features.map((f, i) => {
        const coords = f.geometry.coordinates as number[];
        return (
          <CircleMarker key={i} center={[coords[1], coords[0]]}
            radius={5}
            pathOptions={{
              fillColor: ORANGE, fillOpacity: 0.75,
              color: ORANGE, weight: 1.5, opacity: 0.9,
            }}>
            <Popup closeButton>
              <BusStopPopup feature={f} />
            </Popup>
          </CircleMarker>
        );
      })}
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
        const cacheKey = `${bus.id}:${bucket}`;
        let icon = iconCache.current.get(cacheKey);
        if (!icon) {
          icon = createBusVehicleIcon(bus.route, bucket);
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

export default function MapView({ data, busStops, busVehicles, visibleCategories, selectedFeature, onFeatureSelect }: Props) {
  return (
    <View style={styles.container}>
      <MapContainer center={CENTER} zoom={14} style={{ width: '100%', height: '100%' }} zoomControl>
        <StylesInjector />
        <TileLayer url={TILE_URL} attribution={TILE_ATTR} />

        {visibleCategories.has('stations') && (
          <PointMarkers features={data.stations.features} category="stations" onSelect={onFeatureSelect} />
        )}
        {visibleCategories.has('taxi') && (
          <PointMarkers features={data.taxi.features} category="taxi" onSelect={onFeatureSelect} />
        )}
        {visibleCategories.has('carsharing') && (
          <PointMarkers features={data.carsharing.features} category="carsharing" onSelect={onFeatureSelect} />
        )}
        {visibleCategories.has('parking') && (
          <ParkingZones features={data.parking.features} onSelect={onFeatureSelect} />
        )}
        {visibleCategories.has('busstops') && (
          <BusStopsLayer features={busStops.features} />
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
