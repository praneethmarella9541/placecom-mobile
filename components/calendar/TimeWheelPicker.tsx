import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { CalendarTheme } from '../../constants/calendarTheme';

const ITEM_HEIGHT = 44;
const VISIBLE_ROWS = 5;
const WHEEL_HEIGHT = ITEM_HEIGHT * VISIBLE_ROWS;
const WHEEL_PADDING = ITEM_HEIGHT * 2;

type WheelColumnProps = {
  label: string;
  items: string[];
  selectedIndex: number;
  onSelect: (index: number) => void;
};

function WheelColumn({ label, items, selectedIndex, onSelect }: WheelColumnProps) {
  const scrollRef = useRef<ScrollView>(null);
  const selectedRef = useRef(selectedIndex);
  const syncingRef = useRef(false);

  useEffect(() => {
    selectedRef.current = selectedIndex;
    syncingRef.current = true;
    const scroll = () => {
      scrollRef.current?.scrollTo({ y: selectedIndex * ITEM_HEIGHT, animated: false });
      requestAnimationFrame(() => {
        syncingRef.current = false;
      });
    };
    scroll();
    const t = setTimeout(scroll, 50);
    return () => clearTimeout(t);
  }, [selectedIndex]);

  function snapIndex(offsetY: number): number {
    return Math.min(Math.max(0, Math.round(offsetY / ITEM_HEIGHT)), items.length - 1);
  }

  function handleScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    if (syncingRef.current) return;
    const idx = snapIndex(e.nativeEvent.contentOffset.y);
    if (idx === selectedRef.current) return;
    selectedRef.current = idx;
    onSelect(idx);
  }

  return (
    <View style={styles.column}>
      <Text style={styles.columnLabel}>{label}</Text>
      <View style={styles.wheelFrame}>
        <View pointerEvents="none" style={styles.selectionBand} />
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
          snapToInterval={ITEM_HEIGHT}
          decelerationRate="fast"
          onMomentumScrollEnd={handleScrollEnd}
          onScrollEndDrag={handleScrollEnd}
        >
          {items.map((item, index) => {
            const selected = index === selectedIndex;
            return (
              <View key={`${label}-${index}`} style={styles.item}>
                <Text style={[styles.itemText, selected && styles.itemTextSelected]}>{item}</Text>
              </View>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

function formatHourLabel(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return '12 PM';
  return `${hour - 12} PM`;
}

const HOUR_ITEMS = Array.from({ length: 24 }, (_, h) => formatHourLabel(h));
const MINUTE_ITEMS = Array.from({ length: 60 }, (_, m) => `:${String(m).padStart(2, '0')}`);

type Props = {
  hour: number;
  minute: number;
  onChange: (hour: number, minute: number) => void;
};

export function TimeWheelPicker({ hour, minute, onChange }: Props) {
  const hourRef = useRef(hour);
  const minuteRef = useRef(minute);
  hourRef.current = hour;
  minuteRef.current = minute;

  return (
    <View style={styles.row}>
      <WheelColumn
        label="Hour"
        items={HOUR_ITEMS}
        selectedIndex={hour}
        onSelect={(h) => {
          if (h !== hourRef.current) onChange(h, minuteRef.current);
        }}
      />
      <WheelColumn
        label="Minute"
        items={MINUTE_ITEMS}
        selectedIndex={minute}
        onSelect={(m) => {
          if (m !== minuteRef.current) onChange(hourRef.current, m);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12 },
  column: { flex: 1 },
  columnLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: CalendarTheme.textSecondary,
    marginBottom: 6,
    textAlign: 'center',
  },
  wheelFrame: {
    height: WHEEL_HEIGHT,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: CalendarTheme.bg,
    borderWidth: 1,
    borderColor: CalendarTheme.border,
  },
  scroll: { height: WHEEL_HEIGHT },
  scrollContent: {
    paddingVertical: WHEEL_PADDING,
  },
  selectionBand: {
    position: 'absolute',
    left: 8,
    right: 8,
    top: WHEEL_PADDING,
    height: ITEM_HEIGHT,
    borderRadius: 8,
    backgroundColor: CalendarTheme.blueLight,
  },
  item: {
    height: ITEM_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemText: { fontSize: 16, color: CalendarTheme.textSecondary },
  itemTextSelected: { color: CalendarTheme.blue, fontWeight: '700' },
});
