import React from 'react';
import { StyleSheet, View } from 'react-native';
import { MapContainer, TileLayer, CircleMarker, Polygon, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
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
const CENTER: [number, number] = [46.068, 11.121];

function PointMarkers({
  features,
  category,
  color,
  onSelect,
}: {
  features: MobilityFeature[];
  category: CategoryKey;
  color: string;
  onSelect: (f: MobilityFeature, c: CategoryKey) => void;
}) {
  return (
    <>
      {features.map((f, i) => {
        const coords = f.geometry.coordinates as number[];
        return (
          <CircleMarker
            key={i}
            center={[coords[1], coords[0]]}
            radius={8}
            pathOptions={{ fillColor: color, fillOpacity: 0.85, color, weight: 2 }}
            eventHandlers={{ click: () => onSelect(f, category) }}
          >
            <Popup>
              <div
                style={{
                  background: '#111',
                  color: '#fff',
                  padding: '8px',
                  borderRadius: '8px',
                  minWidth: '160px',
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 4 }}>
                  {CategoryIcons[category]}{' '}
                  {String(
                    f.properties.name ||
                      f.properties.nome ||
                      f.properties.via ||
                      'Location'
                  )}
                </div>
                {Object.entries(f.properties)
                  .filter(([k]) => !['name', 'nome'].includes(k))
                  .map(([k, v]) => (
                    <div
                      key={k}
                      style={{
                        fontSize: 11,
                        color: 'rgba(255,255,255,0.5)',
                        marginBottom: 2,
                      }}
                    >
                      {k}: {String(v)}
                    </div>
                  ))}
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
}

function ParkingPolygons({
  features,
  color,
  onSelect,
}: {
  features: MobilityFeature[];
  color: string;
  onSelect: (f: MobilityFeature, c: CategoryKey) => void;
}) {
  return (
    <>
      {features.map((f, i) => {
        const coords = (f.geometry.coordinates as number[][][])[0].map(
          (c) => [c[1], c[0]] as [number, number]
        );
        return (
          <Polygon
            key={i}
            positions={coords}
            pathOptions={{ fillColor: color, fillOpacity: 0.15, color, weight: 1.5 }}
            eventHandlers={{ click: () => onSelect(f, 'parking') }}
          >
            <Popup>
              <div
                style={{
                  background: '#111',
                  color: '#fff',
                  padding: '8px',
                  borderRadius: '8px',
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 4 }}>
                  🅿️{' '}
                  {String(
                    f.properties.zona ||
                      f.properties.descrizione ||
                      'Parcheggio'
                  )}
                </div>
                {f.properties.descrizione && (
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
                    {String(f.properties.descrizione)}
                  </div>
                )}
              </div>
            </Popup>
          </Polygon>
        );
      })}
    </>
  );
}

export default function MapView({
  data,
  visibleCategories,
  selectedFeature,
  onFeatureSelect,
}: Props) {
  return (
    <View style={styles.container}>
      <MapContainer
        center={CENTER}
        zoom={14}
        style={{ width: '100%', height: '100%' }}
        zoomControl={false}
      >
        <TileLayer url={TILE_URL} attribution={TILE_ATTR} />
        {visibleCategories.has('stations') && (
          <PointMarkers
            features={data.stations.features}
            category="stations"
            color={CategoryColors.stations}
            onSelect={onFeatureSelect}
          />
        )}
        {visibleCategories.has('taxi') && (
          <PointMarkers
            features={data.taxi.features}
            category="taxi"
            color={CategoryColors.taxi}
            onSelect={onFeatureSelect}
          />
        )}
        {visibleCategories.has('carsharing') && (
          <PointMarkers
            features={data.carsharing.features}
            category="carsharing"
            color={CategoryColors.carsharing}
            onSelect={onFeatureSelect}
          />
        )}
        {visibleCategories.has('parking') && (
          <ParkingPolygons
            features={data.parking.features}
            color={CategoryColors.parking}
            onSelect={onFeatureSelect}
          />
        )}
      </MapContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
