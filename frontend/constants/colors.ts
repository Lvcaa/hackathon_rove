export const Colors = {
  bg: '#0d0d0d',
  surface: '#111111',
  surface2: '#1a1a1a',
  border: 'rgba(255,255,255,0.08)',
  textPrimary: '#ffffff',
  textMuted: 'rgba(255,255,255,0.45)',
  cyan: '#00e5ff',
  yellow: '#fbbf24',
  purple: '#a78bfa',
  green: '#34d399',
} as const;

export const CategoryColors: Record<string, string> = {
  stations: Colors.cyan,
  taxi: Colors.yellow,
  carsharing: Colors.purple,
  parking: Colors.green,
};

export const CategoryIcons: Record<string, string> = {
  stations: '🚂',
  taxi: '🚕',
  carsharing: '🚗',
  parking: '🅿️',
};

export const CategoryLabels: Record<string, string> = {
  stations: 'Stazioni',
  taxi: 'Taxi',
  carsharing: 'Car Share',
  parking: 'Parcheggi',
};
