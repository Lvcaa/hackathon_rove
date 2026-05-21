import React, { useEffect, useState, useCallback } from 'react';
import { useMobilityData } from '../hooks/useMobilityData';
import { Stats } from '../types/mobility';

const API_BASE  = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';
const AUTH      = 'Basic ' + btoa('admin:1234');
const FONT      = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  bg:      '#0a0a0f',
  surface: '#111118',
  card:    '#16161f',
  border:  'rgba(255,255,255,0.08)',
  text:    '#f5f5f5',
  muted:   'rgba(255,255,255,0.4)',
  cyan:    '#00e5ff',
  yellow:  '#fbbf24',
  purple:  '#a78bfa',
  green:   '#34d399',
  red:     '#ef4444',
};

const TYPE_OPTIONS = ['station', 'parking', 'museum', 'hospital', 'school', 'park', 'other'];

const TYPE_COLOR: Record<string, string> = {
  station:  C.cyan,
  parking:  C.green,
  museum:   C.purple,
  hospital: C.red,
  school:   C.yellow,
  park:     '#86efac',
  other:    C.muted,
};

// ── Stat cards ─────────────────────────────────────────────────────────────────
const STAT_CARDS = [
  { key: 'stations'      as keyof Stats, label: 'Stazioni',   icon: '🚉', color: C.cyan   },
  { key: 'taxi'          as keyof Stats, label: 'Taxi',        icon: '🚕', color: C.yellow },
  { key: 'carsharing'    as keyof Stats, label: 'Car sharing', icon: '🚗', color: C.purple },
  { key: 'parking_zones' as keyof Stats, label: 'Parcheggi',  icon: '🅿️', color: C.green  },
];

// ── Types ──────────────────────────────────────────────────────────────────────
interface Destination {
  id: string;
  name: string;
  type: string;
  lat: number;
  lng: number;
}

interface ParkingZone {
  id: string;
  name: string;
  max_capacity: number;
  available_spots: number;
  occupancy_pct: number;
  distress: boolean;
}

interface DashboardData {
  zones: ParkingZone[];
  summary: { total_zones: number; configured_zones: number; distressed: number; full: number };
}

const EMPTY_FORM = { name: '', type: 'station', lat: '', lng: '' };

// ── Helpers ────────────────────────────────────────────────────────────────────
function adminFetch(path: string, opts?: RequestInit) {
  return fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: AUTH, ...opts?.headers },
  });
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function StatCard({ label, icon, color, value }: { label: string; icon: string; color: string; value: number }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 14,
      padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14,
      boxShadow: `0 0 28px ${color}12`,
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: 12, flexShrink: 0, fontSize: 20,
        background: color + '18', border: `1px solid ${color}33`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{icon}</div>
      <div>
        <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</div>
        <div style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1.1 }}>{value}</div>
      </div>
    </div>
  );
}

function TypeBadge({ type }: { type: string }) {
  const color = TYPE_COLOR[type] ?? C.muted;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
      color, background: color + '18', border: `1px solid ${color}33`,
      borderRadius: 6, padding: '2px 8px',
    }}>{type}</span>
  );
}

// ── Main export ────────────────────────────────────────────────────────────────
export default function DashboardScreen() {
  const { stats } = useMobilityData();
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [parking, setParking] = useState<DashboardData | null>(null);
  const [form, setForm] = useState<typeof EMPTY_FORM>(EMPTY_FORM);
  const [editId, setEditId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    adminFetch('/admin/dashboard')
      .then((r) => r.json())
      .then((d) => setParking(d))
      .catch(() => {});
  }, []);

  const loadDestinations = useCallback(() => {
    adminFetch('/admin/destinations')
      .then((r) => r.json())
      .then((d) => setDestinations(d.destinations ?? []))
      .catch(() => setError('Errore nel caricamento delle destinazioni'));
  }, []);

  useEffect(() => { loadDestinations(); }, [loadDestinations]);

  const handleEdit = (d: Destination) => {
    setEditId(d.id);
    setForm({ name: d.name, type: d.type, lat: String(d.lat), lng: String(d.lng) });
    setError(null);
  };

  const handleCancelEdit = () => { setEditId(null); setForm(EMPTY_FORM); setError(null); };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Eliminare "${name}"?`)) return;
    const r = await adminFetch(`/admin/destinations/${id}`, { method: 'DELETE' });
    if (r.ok) loadDestinations();
    else setError('Errore durante l\'eliminazione');
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Il nome è obbligatorio'); return; }
    const lat = parseFloat(form.lat);
    const lng = parseFloat(form.lng);
    if (isNaN(lat) || isNaN(lng)) { setError('Latitudine e longitudine devono essere numeriche'); return; }

    setSaving(true);
    setError(null);
    try {
      const body = JSON.stringify({ name: form.name.trim(), type: form.type, lat, lng });
      const r = editId
        ? await adminFetch(`/admin/destinations/${editId}`, { method: 'PUT', body })
        : await adminFetch('/admin/destinations', { method: 'POST', body });

      if (!r.ok) throw new Error((await r.json()).detail ?? 'Errore');
      setForm(EMPTY_FORM);
      setEditId(null);
      loadDestinations();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', background: C.bg, color: C.text,
      fontFamily: FONT, padding: '32px 28px',
    }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 11,
            background: C.cyan + '20', border: `1.5px solid ${C.cyan}60`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, fontWeight: 800, color: C.cyan,
          }}>CS</div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>CommuteSync</h1>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: C.muted }}>Pannello amministratore</p>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px,1fr))', gap: 12, marginBottom: 36 }}>
        {STAT_CARDS.map((c) => (
          <StatCard key={c.key} label={c.label} icon={c.icon} color={c.color} value={stats[c.key]} />
        ))}
      </div>

      {/* Unified locations table */}
      <div style={{
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '18px 24px', borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Punti di interesse &amp; parcheggi</h2>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: C.muted }}>
              {destinations.length} destinazioni
              {parking?.summary && (
                <span style={{ marginLeft: 10 }}>
                  · {parking.summary.configured_zones}/{parking.summary.total_zones} parcheggi configurati
                  {parking.summary.distressed > 0 && <span style={{ color: C.red, marginLeft: 8 }}>⚠ {parking.summary.distressed} in sofferenza</span>}
                </span>
              )}
            </p>
          </div>
          {!editId && (
            <button
              onClick={() => { setEditId('__new__'); setForm(EMPTY_FORM); setError(null); }}
              style={{
                background: C.cyan, color: '#000', border: 'none', borderRadius: 9,
                padding: '8px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: FONT,
              }}
            >+ Aggiungi</button>
          )}
        </div>

        {/* Add / Edit form */}
        {editId && (
          <div style={{
            padding: '18px 24px', background: C.card, borderBottom: `1px solid ${C.border}`,
            display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.cyan, marginBottom: 4 }}>
              {editId === '__new__' ? '+ Nuovo luogo' : `✏ Modifica — ${destinations.find(d => d.id === editId)?.name}`}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                { field: 'name', label: 'Nome', placeholder: 'es. MART Rovereto' },
                { field: 'lat',  label: 'Latitudine',  placeholder: 'es. 45.8906' },
                { field: 'lng',  label: 'Longitudine', placeholder: 'es. 11.0407' },
              ].map(({ field, label, placeholder }) => (
                <div key={field} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</label>
                  <input
                    value={(form as any)[field]}
                    onChange={(e) => setForm((p) => ({ ...p, [field]: e.target.value }))}
                    placeholder={placeholder}
                    style={{
                      background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.border}`,
                      borderRadius: 8, padding: '8px 11px', color: C.text,
                      fontSize: 13, fontFamily: FONT, outline: 'none',
                    }}
                  />
                </div>
              ))}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Tipo</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm((p) => ({ ...p, type: e.target.value }))}
                  style={{
                    background: '#1a1a24', border: `1px solid ${C.border}`,
                    borderRadius: 8, padding: '8px 11px', color: C.text,
                    fontSize: 13, fontFamily: FONT, outline: 'none',
                  }}
                >
                  {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            {error && <p style={{ margin: 0, fontSize: 12, color: C.red }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleSave} disabled={saving} style={{
                background: C.cyan, color: '#000', border: 'none', borderRadius: 8,
                padding: '9px 20px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: FONT,
                opacity: saving ? 0.6 : 1,
              }}>{saving ? 'Salvataggio...' : 'Salva'}</button>
              <button onClick={handleCancelEdit} style={{
                background: 'transparent', color: C.muted, border: `1px solid ${C.border}`,
                borderRadius: 8, padding: '9px 16px', fontSize: 12, cursor: 'pointer', fontFamily: FONT,
              }}>Annulla</button>
            </div>
          </div>
        )}

        {/* Table — destinations + parking zones */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {['Nome', 'Tipo', 'Posizione', 'Riempimento', 'Azioni'].map((h) => (
                  <th key={h} style={{
                    padding: '10px 20px', textAlign: 'left',
                    fontSize: 10, fontWeight: 700, color: C.muted,
                    textTransform: 'uppercase', letterSpacing: '0.08em',
                    whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* ── Destinations ── */}
              {destinations.map((d, i) => (
                <tr key={d.id} style={{
                  borderBottom: `1px solid ${C.border}`,
                  background: editId === d.id ? C.cyan + '08' : 'transparent',
                }}>
                  <td style={{ padding: '12px 20px', fontWeight: 600, minWidth: 160 }}>{d.name}</td>
                  <td style={{ padding: '12px 20px' }}><TypeBadge type={d.type} /></td>
                  <td style={{ padding: '12px 20px', fontFamily: 'monospace', fontSize: 11, color: C.muted, whiteSpace: 'nowrap' }}>
                    {d.lat.toFixed(4)}, {d.lng.toFixed(4)}
                  </td>
                  <td style={{ padding: '12px 20px', minWidth: 160 }}>
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)' }}>—</span>
                  </td>
                  <td style={{ padding: '12px 20px' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => handleEdit(d)} style={{
                        background: 'rgba(255,255,255,0.06)', border: `1px solid ${C.border}`,
                        borderRadius: 7, padding: '5px 12px', color: C.text,
                        fontSize: 11, cursor: 'pointer', fontFamily: FONT,
                      }}>✏</button>
                      <button onClick={() => handleDelete(d.id, d.name)} style={{
                        background: C.red + '14', border: `1px solid ${C.red}33`,
                        borderRadius: 7, padding: '5px 12px', color: C.red,
                        fontSize: 11, cursor: 'pointer', fontFamily: FONT,
                      }}>✕</button>
                    </div>
                  </td>
                </tr>
              ))}

              {/* ── Parking zones ── */}
              {(parking?.zones ?? []).map((z) => {
                const configured = z.max_capacity > 0;
                const pct   = z.occupancy_pct;
                const color = !configured ? 'rgba(255,255,255,0.18)'
                            : z.distress  ? C.red
                            : pct > 60    ? C.yellow
                            : C.green;
                return (
                  <tr key={z.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: '12px 20px', fontWeight: 600 }}>
                      {z.distress && <span style={{ color: C.red, marginRight: 5 }}>⚠</span>}
                      {z.name}
                    </td>
                    <td style={{ padding: '12px 20px' }}><TypeBadge type="parking" /></td>
                    <td style={{ padding: '12px 20px', fontFamily: 'monospace', fontSize: 11, color: C.muted }}>—</td>
                    <td style={{ padding: '12px 20px', minWidth: 180 }}>
                      {configured ? (
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ fontSize: 10, color: C.muted }}>{z.available_spots}/{z.max_capacity} liberi</span>
                            <span style={{ fontSize: 11, fontWeight: 700, color }}>{pct}%</span>
                          </div>
                          <div style={{ height: 5, borderRadius: 5, background: 'rgba(255,255,255,0.07)' }}>
                            <div style={{
                              height: '100%', borderRadius: 5, width: `${pct}%`,
                              background: color,
                              transition: 'width 0.7s cubic-bezier(0.16,1,0.3,1)',
                            }} />
                          </div>
                        </div>
                      ) : (
                        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', fontStyle: 'italic' }}>non configurata</span>
                      )}
                    </td>
                    <td style={{ padding: '12px 20px' }}>
                      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>—</span>
                    </td>
                  </tr>
                );
              })}
              {destinations.length === 0 && (!parking?.zones || parking.zones.length === 0) && (
                <tr>
                  <td colSpan={5} style={{ padding: '32px 24px', textAlign: 'center', color: C.muted, fontSize: 13 }}>
                    Nessun dato disponibile
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
