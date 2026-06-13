import { subDays, format } from 'date-fns';

export function analyticsRangeEndingToday(days: number): { from: string; to: string; label: string; allTime?: boolean } {
  const to = new Date();
  const from = subDays(to, days - 1);
  return {
    from: format(from, 'yyyy-MM-dd'),
    to: format(to, 'yyyy-MM-dd'),
    label: `${days} days`,
  };
}

export const ALL_TIME_RANGE = { from: '', to: '', label: 'All time', allTime: true as const };
