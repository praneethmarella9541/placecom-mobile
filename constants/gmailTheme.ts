/** Mail module palette — warm/copper editorial theme, matching the web app. */
export const Gmail = {
  red: '#DC2626',
  redDark: '#B91C1C',
  blue: '#C45C1A',
  blueLight: 'rgba(196, 92, 26, 0.10)',
  star: '#F4B400',
  bg: '#F5F3EF',
  bgMuted: '#EDE9E1',
  text: '#1A1612',
  textSecondary: '#4A443C',
  textMuted: '#8C857B',
  border: 'rgba(20, 18, 14, 0.09)',
  divider: 'rgba(20, 18, 14, 0.09)',
  searchBg: '#FFFFFF',
  fab: '#C45C1A',
  fabIcon: '#FFFFFF',
};

const AVATAR_COLORS = [
  '#C45C1A', '#2563EB', '#166534', '#B45309', '#7C4A1E', '#0F766E', '#B91C1C', '#4338CA',
];

export function avatarColorForName(name: string): string {
  let h = 0;
  const s = name || '?';
  for (let i = 0; i < s.length; i++) h = (h + s.charCodeAt(i)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h]!;
}
