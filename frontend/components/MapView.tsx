import React from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import {
  MobilityData, MobilityFeature, MobilityCollection, CategoryKey, BusVehicle,
} from '../types/mobility';

interface Props {
  data: MobilityData;
  busStops: MobilityCollection;
  busVehicles: BusVehicle[];
  visibleCategories: Set<CategoryKey>;
  selectedFeature: MobilityFeature | null;
  onFeatureSelect: (feature: MobilityFeature, category: CategoryKey) => void;
}

export default function MapView({ data, visibleCategories }: Props) {
  const mapHtml = `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#map{margin:0;padding:0;width:100%;height:100%}body{background:#0d0d0d}</style>
</head>
<body>
<div id="map"></div>
<script>
const map = L.map('map').setView([46.068,11.121],14);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{
  attribution:'OpenStreetMap / CARTO'
}).addTo(map);
const data = ${JSON.stringify(data)};
const vis = ${JSON.stringify(Array.from(visibleCategories))};
const colors = {stations:'#00e5ff',taxi:'#fbbf24',carsharing:'#a78bfa',parking:'#34d399'};
const icons = {stations:'\u{1F682}',taxi:'\u{1F695}',carsharing:'\u{1F697}',parking:'\u{1F17F}️'};
function addPoints(features, cat) {
  features.forEach(function(f) {
    var coords = f.geometry.coordinates;
    var lon = coords[0], lat = coords[1];
    L.circleMarker([lat,lon],{radius:8,fillColor:colors[cat],fillOpacity:0.85,color:colors[cat],weight:2})
      .bindPopup('<b>' + icons[cat] + ' ' + (f.properties.name||f.properties.nome||f.properties.via||cat) + '</b>')
      .addTo(map);
  });
}
if(vis.indexOf('stations') !== -1) addPoints(data.stations.features,'stations');
if(vis.indexOf('taxi') !== -1) addPoints(data.taxi.features,'taxi');
if(vis.indexOf('carsharing') !== -1) addPoints(data.carsharing.features,'carsharing');
</script>
</body>
</html>`;

  return (
    <View style={styles.container}>
      <WebView source={{ html: mapHtml }} style={styles.webview} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  webview: { flex: 1 },
});
