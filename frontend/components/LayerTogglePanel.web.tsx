import React, { useEffect, useRef, useState } from 'react';
import { CategoryKey, Stats } from '../types/mobility';
import { CategoryColors, CategoryIcons, CategoryLabels, Colors } from '../constants/colors';

interface Props {
  visible: Set<CategoryKey>;
  onToggle: (cat: CategoryKey) => void;
  stats: Stats;
}

const LAYERS: CategoryKey[] = [
  'stations', 'taxi', 'carsharing', 'parking',
  'busstops_urban', 'busstops_extraurban', 'buses',
];

const STATS_CFG: { key: keyof Stats; label: string; icon: string; color: string }[] = [
  { key: 'stations',      label: 'Stazioni',     icon: '🚂', color: Colors.cyan   },
  { key: 'taxi',          label: 'Taxi',          icon: '🚕', color: Colors.yellow },
  { key: 'carsharing',    label: 'Car share',     icon: '🚗', color: Colors.purple },
  { key: 'parking_zones', label: 'Parcheggi',     icon: '🅿️', color: Colors.green  },
  { key: 'busstops',      label: 'Fermate bus',   icon: '🚏', color: Colors.orange },
  { key: 'buses_live',    label: 'Bus in corsa',  icon: '🚍', color: Colors.orange },
];

// ── CSS ────────────────────────────────────────────────────────────────────────

function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById('cs-lp-css')) return;
  const s = document.createElement('style');
  s.id = 'cs-lp-css';
  s.textContent = `
    .cs-lp {
      position: absolute; top: 12px; right: 12px;
      width: 44px; height: 44px;
      z-index: 1000;
      background: rgba(18,18,20,0.55);
      backdrop-filter: blur(22px) saturate(180%);
      -webkit-backdrop-filter: blur(22px) saturate(180%);
      border: 1px solid rgba(255,255,255,0.14);
      border-radius: 16px; overflow: hidden;
      box-shadow: 0 8px 32px rgba(0,0,0,0.45);
      transition: width 0.24s cubic-bezier(0.4,0,0.2,1),
                  height 0.26s cubic-bezier(0.4,0,0.2,1);
      cursor: default;
    }

    /* Narrow-state pill — fades out when panel opens */
    .cs-lp-pill {
      position: absolute; top: 0; right: 0;
      width: 44px; height: 44px;
      display: flex; align-items: center; justify-content: center;
      pointer-events: none;
      transition: opacity 0.12s ease;
    }
    .cs-lp.open .cs-lp-pill { opacity: 0; }

    /* Full content — fades in when panel opens */
    .cs-lp-full {
      width: 244px; min-width: 244px;
      opacity: 0; pointer-events: none;
      transition: opacity 0.14s ease;
    }
    .cs-lp.open .cs-lp-full {
      opacity: 1; pointer-events: auto;
      transition-delay: 0.08s;
    }

    .cs-lp-hdr {
      display: flex; align-items: center; gap: 8px;
      padding: 11px 14px; height: 44px; box-sizing: border-box;
      cursor: pointer; user-select: none;
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
    }
    .cs-lp-hdr-title {
      flex: 1; font-size: 12px; font-weight: 700;
      color: rgba(255,255,255,0.9); letter-spacing: 0.3px;
    }
    .cs-lp-hdr-chev {
      font-size: 13px; color: rgba(255,255,255,0.45); font-weight: 700;
      display: inline-block; transition: transform 0.24s ease;
    }
    .cs-lp-hdr-chev.up { transform: rotate(-90deg); }

    .cs-lp-body {
      overflow: hidden;
      transition: height 0.24s ease;
    }
    .cs-lp-body-inner { border-top: 1px solid rgba(255,255,255,0.06); }

    .cs-lp-rows { padding: 4px 0 6px; }
    .cs-lp-row {
      display: flex; align-items: center; gap: 10px;
      padding: 7px 14px; cursor: pointer;
      border-radius: 9px; margin: 0 6px;
      transition: background 0.12s;
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
    }
    .cs-lp-row:hover { background: rgba(255,255,255,0.06); }
    .cs-lp-row-ico { font-size: 14px; width: 18px; text-align: center; flex-shrink: 0; }
    .cs-lp-row-lbl { flex: 1; font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.9); }
    .cs-lp-row-lbl.off { color: rgba(255,255,255,0.35); }

    .cs-lp-track {
      width: 40px; height: 22px; border-radius: 11px;
      position: relative; flex-shrink: 0; transition: background 0.2s;
    }
    .cs-lp-knob {
      position: absolute; top: 2px; width: 18px; height: 18px;
      border-radius: 9px; background: #fff;
      box-shadow: 0 1px 3px rgba(0,0,0,0.35);
      transition: left 0.2s ease;
    }

    .cs-lp-stats {
      border-top: 1px solid rgba(255,255,255,0.08);
      padding: 9px 10px 10px;
    }
    .cs-lp-stats-head {
      font-size: 9px; font-weight: 700; letter-spacing: 0.6px;
      text-transform: uppercase; color: rgba(255,255,255,0.35);
      margin: 0 0 7px 2px;
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
    }
    .cs-lp-stats-grid { display: flex; flex-wrap: wrap; gap: 6px; }
    .cs-lp-stat-cell {
      width: calc(50% - 3px); display: flex; align-items: center; gap: 7px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 10px; padding: 7px 9px; box-sizing: border-box;
    }
    .cs-lp-stat-ico { font-size: 15px; }
    .cs-lp-stat-val {
      font-size: 16px; font-weight: 800; line-height: 1.2;
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
    }
    .cs-lp-stat-lbl {
      font-size: 9px; color: rgba(255,255,255,0.4); margin-top: 1px;
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
    }
  `;
  document.head.appendChild(s);
}

// ── Layer stack icon (SVG) ─────────────────────────────────────────────────────

function LayerIcon({ size = 18, opacity = 1 }: { size?: number; opacity?: number }) {
  const c = `rgba(255,255,255,${opacity})`;
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Top solid layer */}
      <path d="M9 1.5L15.5 5.5L9 9.5L2.5 5.5Z" fill={c} />
      {/* Middle chevron */}
      <path d="M2.5 9L9 13L15.5 9" stroke={c} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.65" />
      {/* Bottom chevron */}
      <path d="M2.5 12.5L9 16.5L15.5 12.5" stroke={c} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.35" />
    </svg>
  );
}

// ── Toggle switch (pure CSS) ───────────────────────────────────────────────────

function Switch({ on, color }: { on: boolean; color: string }) {
  return (
    <div className="cs-lp-track" style={{ background: on ? color : 'rgba(255,255,255,0.14)' }}>
      <div className="cs-lp-knob" style={{ left: on ? 20 : 2 }} />
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function LayerTogglePanel({ visible, onToggle, stats }: Props) {
  useEffect(() => { injectStyles(); }, []);

  const panelRef = useRef<HTMLDivElement>(null);
  const bodyInnerRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(true);
  const [bodyH, setBodyH] = useState(0);

  // Measure body content height once on mount.
  useEffect(() => {
    if (bodyInnerRef.current) {
      const h = bodyInnerRef.current.scrollHeight;
      if (h > 0) setBodyH(h);
    }
  }, []);

  // Sync panel outer height whenever hover or expand state changes.
  const syncHeight = (open: boolean, exp: boolean) => {
    const panel = panelRef.current;
    if (!panel) return;
    if (!open) {
      panel.style.height = '44px';
      panel.style.width = '44px';
      return;
    }
    panel.style.width = '244px';
    // header (44px) + body (measured or 0 if collapsed)
    const measured = bodyInnerRef.current?.scrollHeight ?? bodyH;
    panel.style.height = (44 + (exp ? measured : 0)) + 'px';
  };

  const hoveredRef = useRef(false);

  const handleMouseEnter = () => {
    hoveredRef.current = true;
    panelRef.current?.classList.add('open');
    syncHeight(true, expanded);
  };

  const handleMouseLeave = () => {
    hoveredRef.current = false;
    panelRef.current?.classList.remove('open');
    syncHeight(false, expanded);
  };

  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    if (hoveredRef.current) syncHeight(true, next);
  };

  return (
    <div
      ref={panelRef}
      className="cs-lp"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Compact pill — visible only when narrow */}
      <div className="cs-lp-pill">
        <LayerIcon size={20} opacity={0.85} />
      </div>

      {/* Full panel — fades in on hover */}
      <div className="cs-lp-full">
        <div className="cs-lp-hdr" onClick={toggleExpanded}>
          <LayerIcon size={16} opacity={0.6} />
          <span className="cs-lp-hdr-title">Livelli mappa</span>
        </div>

        {/* Collapsible body: layer toggles + stats */}
        <div
          className="cs-lp-body"
          style={{ height: bodyH > 0 ? (expanded ? bodyH : 0) : undefined }}
        >
          <div ref={bodyInnerRef} className="cs-lp-body-inner">
            <div className="cs-lp-rows">
              {LAYERS.map((key) => {
                const on = visible.has(key);
                const color = CategoryColors[key];
                return (
                  <div key={key} className="cs-lp-row" onClick={() => onToggle(key)}>
                    <span className="cs-lp-row-ico">{CategoryIcons[key]}</span>
                    <span className={`cs-lp-row-lbl${on ? '' : ' off'}`}>{CategoryLabels[key]}</span>
                    <Switch on={on} color={color} />
                  </div>
                );
              })}
            </div>

            <div className="cs-lp-stats">
              <div className="cs-lp-stats-head">Risorse in rete</div>
              <div className="cs-lp-stats-grid">
                {STATS_CFG.map(({ key, label, icon, color }) => (
                  <div key={String(key)} className="cs-lp-stat-cell">
                    <span className="cs-lp-stat-ico">{icon}</span>
                    <div>
                      <div className="cs-lp-stat-val" style={{ color }}>{stats[key]}</div>
                      <div className="cs-lp-stat-lbl">{label}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
