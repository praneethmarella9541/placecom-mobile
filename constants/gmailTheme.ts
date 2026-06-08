/** Gmail-inspired palette for the mail module (list, thread, compose). */
export const Gmail = {
  red: '#D93025',
  redDark: '#C5221F',
  blue: '#1A73E8',
  blueLight: '#E8F0FE',
  star: '#F4B400',
  bg: '#FFFFFF',
  bgMuted: '#F6F8FC',
  text: '#202124',
  textSecondary: '#5F6368',
  textMuted: '#80868B',
  border: '#E8EAED',
  divider: '#F1F3F4',
  searchBg: '#EAF1FB',
  fab: '#C2E7FF',
  fabIcon: '#001D35',
};

const AVATAR_COLORS = [
  '#1A73E8', '#D93025', '#188038', '#E37400', '#9334E6', '#0B8043', '#C5221F', '#4285F4',
];

export function avatarColorForName(name: string): string {
  let h = 0;
  const s = name || '?';
  for (let i = 0; i < s.length; i++) h = (h + s.charCodeAt(i)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h]!;
}
