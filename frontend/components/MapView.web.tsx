import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { MapContainer, TileLayer, Marker, Polygon, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { MobilityData, MobilityFeature, CategoryKey } from '../types/mobility';
import { CategoryColors, CategoryIcons, CategoryLabels } from '../constants/colors';

interface Props {
  data: MobilityData;
  visibleCategories: Set<CategoryKey>;
  selectedFeature: MobilityFeature | null;
  onFeatureSelect: (feature: MobilityFeature, category: CategoryKey) => void;
}

const TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
const CENTER: [number, number] = [46.072, 11.121];

function injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('cs-leaflet-css')) return;

  const link = document.createElement('link');
  link.id = 'cs-leaflet-css';
  link.rel = 'stylesheet';
  link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  document.head.appendChild(link);

  const style = document.createElement('style');
  style.id = 'cs-map-styles';
  style.textContent = `
    html, body { margin: 0; padding: 0; }

    .leaflet-container {
      background: #0d1117 !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
    }

    /* Dark popup wrapper */
    .leaflet-popup-content-wrapper {
      background: rgba(15, 15, 18, 0.96) !important;
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(255,255,255,0.1) !important;
      border-radius: 16px !important;
      box-shadow: 0 12px 40px rgba(0,0,0,0.7) !important;
      padding: 0 !important;
      color: #fff !important;
      min-width: 200px;
    }
    .leaflet-popup-content {
      margin: 0 !important;
      color: #fff !important;
    }
    .leaflet-popup-tip-container {
      display: none !important;
    }
    .leaflet-popup-close-button {
      color: rgba(255,255,255,0.4) !important;
      font-size: 18px !important;
      top: 10px !important;
      right: 12px !important;
      width: 24px !important;
      height: 24px !important;
      line-height: 24px !important;
    }
    .leaflet-popup-close-button:hover {
      color: #fff !important;
      background: transparent !important;
    }

    /* Attribution */
    .leaflet-control-attribution {
      background: rgba(0,0,0,0.6) !important;
      color: rgba(255,255,255,0.35) !important;
      font-size: 10px !important;
      border-radius: 6px 0 0 0 !important;
    }
    .leaflet-control-attribution a { color: rgba(255,255,255,0.5) !important; }

    /* Zoom control */
    .leaflet-control-zoom a {
      background: rgba(17,17,17,0.9) !important;
      color: rgba(255,255,255,0.7) !important;
      border-color: rgba(255,255,255,0.1) !important;
    }
    .leaflet-control-zoom a:hover {
      background: rgba(30,30,30,0.95) !important;
      color: #fff !important;
    }
    .leaflet-bar {
      border: 1px solid rgba(255,255,255,0.1) !important;
      border-radius: 10px !important;
      overflow: hidden;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5) !important;
    }

    /* Custom marker */
    .cs-marker {
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      cursor: pointer;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    .cs-marker:hover {
      transform: scale(1.15);
    }
  `;
  document.head.appendChild(style);
}

function createIcon(category: CategoryKey) {
  const color = CategoryColors[category];
  const icon = CategoryIcons[category];
  return L.divIcon({
    className: '',
    html: `<div class="cs-marker" style="
      width:40px;height:40px;
      background:${color}20;
      border:2.5px solid ${color};
      box-shadow:0 0 16px ${color}55, 0 2px 8px rgba(0,0,0,0.5);
      font-size:18px;
    ">${icon}</div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    popupAnchor: [0, -24],
  });
}

function getDisplayName(f: MobilityFeature): string {
  const p = f.properties;
  return String(p.nome || p.name || p.via || p.zona || p.descrizione || 'Posizione');
}

function PopupContent({ feature, category }: { feature: MobilityFeature; category: CategoryKey }) {
  const color = CategoryColors[category];
  const name = getDisplayName(feature);
  const props = Object.entries(feature.properties).filter(
    ([k]) => !['nome', 'name', 'zona'].includes(k) && feature.properties[k] !== null
  );

  return (
    <div style={{ padding: '16px 20px 16px', minWidth: 200 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, paddingRight: 16 }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          background: color + '22', border: `1.5px solid ${color}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15,
          flexShrink: 0,
        }}>
          {CategoryIcons[category]}
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#fff', lineHeight: 1.2 }}>{name}</div>
          <div style={{ fontSize: 11, color: color, marginTop: 2, fontWeight: 600 }}>{CategoryLabels[category]}</div>
        </div>
      </div>

      {props.slice(0, 3).map(([k, v]) => (
        <div key={k} style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '5px 0', borderTop: '1px solid rgba(255,255,255,0.06)',
        }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'capitalize' }}>{k}</span>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', fontWeight: 500 }}>{String(v)}</span>
        </div>
      ))}

      <div style={{
        marginTop: 12,
        background: color + '18',
        border: `1px solid ${color}44`,
        borderRadius: 8, padding: '8px 0',
        textAlign: 'center', cursor: 'pointer',
        fontSize: 12, fontWeight: 700, color,
        letterSpacing: '0.02em',
      }}>
        Naviga →
      </div>
    </div>
  );
}

function PointMarkers({ features, category, onSelect }: {
  features: MobilityFeature[];
  category: CategoryKey;
  onSelect: (f: MobilityFeature, c: CategoryKey) => void;
}) {
  const icon = createIcon(category);
  return (
    <>
      {features.map((f, i) => {
        const coords = f.geometry.coordinates as number[];
        return (
          <Marker
            key={i}
            position={[coords[1], coords[0]]}
            icon={icon}
            eventHandlers={{ click: () => onSelect(f, category) }}
          >
            <Popup closeButton>
              <PopupContent feature={f} category={category} />
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
        const rings = (f.geometry.coordinates as number[][][]);
        const positions = rings[0].map((c) => [c[1], c[0]] as [number, number]);
        return (
          <Polygon
            key={i}
            positions={positions}
            pathOptions={{
              fillColor: color,
              fillOpacity: 0.12,
              color,
              weight: 1.5,
              opacity: 0.6,
            }}
            eventHandlers={{ click: () => onSelect(f, 'parking') }}
          >
            <Popup closeButton>
              <PopupContent feature={f} category="parking" />
            </Popup>
          </Polygon>
        );
      })}
    </>
  );
}

function StylesInjector() {
  useEffect(() => { injectStyles(); }, []);
  return null;
}

export default function MapView({ data, visibleCategories, selectedFeature, onFeatureSelect }: Props) {
  return (
    <View style={styles.container}>
      <MapContainer
        center={CENTER}
        zoom={14}
        style={{ width: '100%', height: '100%' }}
        zoomControl
      >
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
      </MapContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
