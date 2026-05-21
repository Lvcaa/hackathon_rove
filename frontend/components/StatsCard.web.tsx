import React, { useEffect, useState } from 'react';
import { Stats } from '../types/mobility';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';
const FONT = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";

interface ParkingZone {
  id: string;
  name: string;
  max_capacity: number;
  available_spots: number;
  occupancy_pct: number;
  distress: boolean;
}

interface Props { stats: Stats; }

const CARDS = [
  { key: 'stations'      as const, label: 'Stazioni',   icon: '🚉', color: '#00e5ff' },
  { key: 'taxi'          as const, label: 'Taxi',        icon: '🚕', color: '#fbbf24' },
  { key: 'carsharing'    as const, label: 'Car sharing', icon: '🚗', color: '#a78bfa' },
  { key: 'parking_zones' as const, label: 'Parcheggi',  icon: '🅿️', color: '#34d399' },
];

export default function StatsCard({ stats }: Props) {
  const [zones, setZones] = useState<ParkingZone[]>([]);

  useEffect(() => {
    fetch(`${API_BASE}/admin/dashboard`, {
      headers: { Authorization: 'Basic ' + btoa('admin:1234') },
    })
      .then((r) => r.json())
      .then((d) => setZones((d.zones as ParkingZone[]).filter((z) => z.max_capacity > 0)))
      .catch(() => {});
  }, []);

  return (
    <div style={{
      position: 'absolute', top: 12, right: 12,
      display: 'flex', flexDirection: 'column', gap: 6,
      fontFamily: FONT, zIndex: 900,
    }}>
      {/* Count cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {CARDS.map(({ key, label, icon, color }) => (
          <div key={key} style={{
            background: 'rgba(13,13,19,0.82)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(255,255,255,0.09)',
            borderRadius: 12,
            padding: '9px 14px',
            minWidth: 160,
            display: 'flex', alignItems: 'center', gap: 10,
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          }}>
            <div style={{
              width: 34, height: 34, borderRadius: 9, flexShrink: 0,
              background: color + '18', border: `1px solid ${color}33`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16,
            }}>{icon}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 1 }}>
                {label}
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1 }}>
                {stats[key]}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Parking occupancy — only when configured zones exist */}
      {zones.length > 0 && (
        <div style={{
          background: 'rgba(13,13,19,0.82)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.09)',
          borderRadius: 12,
          padding: '10px 14px',
          minWidth: 160,
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        }}>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
            Occupazione parcheggi
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {zones.map((z) => {
              const pct  = z.occupancy_pct;
              const color = z.distress ? '#ef4444' : pct > 60 ? '#fbbf24' : '#34d399';
              return (
                <div key={z.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }}>
                      {z.distress && <span style={{ color: '#ef4444', marginRight: 4 }}>⚠</span>}
                      {z.name}
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700, color }}>{pct}%</span>
                  </div>
                  <div style={{ height: 4, borderRadius: 4, background: 'rgba(255,255,255,0.08)' }}>
                    <div style={{
                      height: '100%', borderRadius: 4,
                      width: `${pct}%`,
                      background: color,
                      transition: 'width 0.6s cubic-bezier(0.16,1,0.3,1)',
                    }} />
                  </div>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginTop: 3 }}>
                    {z.available_spots} / {z.max_capacity} posti liberi
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
