import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { DriveTheme } from '../../constants/driveTheme';

function Shimmer({ width, height, style }: { width: number | string; height: number; style?: object }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    ).start();
  }, [anim]);
  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.7] });
  return (
    <Animated.View
      style={[
        { width: width as number, height, borderRadius: 8, backgroundColor: DriveTheme.divider, opacity },
        style,
      ]}
    />
  );
}

export function DriveListSkeleton() {
  return (
    <View style={styles.row}>
      <Shimmer width={40} height={40} style={{ borderRadius: 10 }} />
      <View style={{ flex: 1, gap: 8 }}>
        <Shimmer width="80%" height={14} />
        <Shimmer width="45%" height={12} />
      </View>
    </View>
  );
}

export function DriveGridSkeleton() {
  return (
    <View style={styles.gridTile}>
      <Shimmer width={48} height={48} style={{ borderRadius: 12, alignSelf: 'center' }} />
      <Shimmer width="90%" height={12} style={{ marginTop: 12, alignSelf: 'center' }} />
      <Shimmer width="60%" height={10} style={{ marginTop: 8, alignSelf: 'center' }} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  gridTile: {
    flex: 1,
    margin: 6,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: DriveTheme.border,
    minHeight: 148,
  },
});
