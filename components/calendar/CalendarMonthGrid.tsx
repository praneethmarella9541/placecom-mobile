import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { format, isSameDay } from 'date-fns';
import { CalendarTheme } from '../../constants/calendarTheme';

export type CalendarMonthGridDay = {
  date: Date;
  label?: string;
  muted?: boolean;
  selected?: boolean;
  today?: boolean;
  bottom?: React.ReactNode;
};

type Props = {
  days: CalendarMonthGridDay[];
  leadingEmptyCells?: number;
  onPressDay?: (date: Date) => void;
  compact?: boolean;
};

function chunkWeeks(cells: (CalendarMonthGridDay | null)[]): (CalendarMonthGridDay | null)[][] {
  const rows: (CalendarMonthGridDay | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    const row = cells.slice(i, i + 7);
    while (row.length < 7) row.push(null);
    rows.push(row);
  }
  return rows;
}

export function CalendarMonthGrid({
  days,
  leadingEmptyCells = 0,
  onPressDay,
  compact = false,
}: Props) {
  const weeks = useMemo(() => {
    const cells: (CalendarMonthGridDay | null)[] = [
      ...Array(Math.max(0, leadingEmptyCells)).fill(null),
      ...days,
    ];
    return chunkWeeks(cells);
  }, [days, leadingEmptyCells]);

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
          <View key={d} style={styles.headerCell}>
            <Text style={styles.headerText}>{d}</Text>
          </View>
        ))}
      </View>
      {weeks.map((week, weekIdx) => (
        <View key={`week-${weekIdx}`} style={styles.weekRow}>
          {week.map((day, dayIdx) => (
            <View key={`day-${weekIdx}-${dayIdx}`} style={[styles.dayCell, compact && styles.dayCellCompact]}>
              {day ? (
                <TouchableOpacity
                  style={styles.dayTap}
                  onPress={() => onPressDay?.(day.date)}
                  activeOpacity={0.7}
                  disabled={!onPressDay}
                >
                  <View
                    style={[
                      styles.dayCircle,
                      compact && styles.dayCircleCompact,
                      day.selected && styles.dayCircleSelected,
                      day.today && !day.selected && styles.dayCircleToday,
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayText,
                        compact && styles.dayTextCompact,
                        day.muted && styles.dayTextMuted,
                        (day.selected || day.today) && styles.dayTextHighlighted,
                      ]}
                    >
                      {day.label ?? format(day.date, 'd')}
                    </Text>
                  </View>
                  {day.bottom}
                </TouchableOpacity>
              ) : null}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%' },
  headerRow: { flexDirection: 'row' },
  headerCell: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  headerText: {
    fontSize: 10,
    fontWeight: '600',
    color: CalendarTheme.textSecondary,
    textAlign: 'center',
  },
  weekRow: { flexDirection: 'row' },
  dayCell: {
    flex: 1,
    minHeight: 72,
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 1,
  },
  dayCellCompact: { minHeight: 40, paddingVertical: 2 },
  dayTap: { width: '100%', alignItems: 'center', gap: 2 },
  dayCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCircleCompact: { width: 30, height: 30, borderRadius: 15 },
  dayCircleSelected: { backgroundColor: CalendarTheme.blue },
  dayCircleToday: { backgroundColor: CalendarTheme.todayRed },
  dayText: { fontSize: 13, color: CalendarTheme.text },
  dayTextCompact: { fontSize: 12 },
  dayTextMuted: { color: CalendarTheme.textMuted },
  dayTextHighlighted: { color: '#fff', fontWeight: '700' },
});
