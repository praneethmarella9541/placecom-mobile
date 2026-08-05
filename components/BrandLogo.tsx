import React from 'react';
import { View, Text, StyleSheet, type ViewStyle } from 'react-native';
import Svg, { Circle, Ellipse } from 'react-native-svg';
import { APP_NAME } from '../constants/branding';
import { Colors } from '../constants/colors';
import { FONTS } from '../constants/fonts';

type Size = 'sm' | 'md' | 'lg';

const SIZES: Record<Size, { mark: number; font: number }> = {
  sm: { mark: 22, font: 16 },
  md: { mark: 32, font: 22 },
  lg: { mark: 44, font: 28 },
};

type Props = {
  size?: Size;
  layout?: 'row' | 'column';
  showName?: boolean;
  nameColor?: string;
  inverted?: boolean;
  style?: ViewStyle;
};

export function BrandMark({ size = 32, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <Circle cx="32" cy="32" r="27" stroke={color} strokeWidth="2.2" />
      <Ellipse cx="32" cy="32" rx="27" ry="11" stroke={color} strokeWidth="2.2" rotation="60" origin="32, 32" />
      <Ellipse cx="32" cy="32" rx="27" ry="11" stroke={color} strokeWidth="2.2" rotation="-60" origin="32, 32" />
      <Circle cx="32" cy="32" r="6" fill={color} />
    </Svg>
  );
}

export function BrandLogo({
  size = 'md',
  layout = 'row',
  showName = true,
  nameColor = Colors.text,
  inverted = false,
  style,
}: Props) {
  const dims = SIZES[size];
  const markColor = inverted ? '#FFFFFF' : Colors.copper;
  return (
    <View style={[styles.row, layout === 'column' && styles.column, style]}>
      <BrandMark size={dims.mark} color={markColor} />
      {showName ? (
        <Text style={[styles.name, { fontSize: dims.font, color: nameColor }]} numberOfLines={1}>
          {APP_NAME}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  column: { flexDirection: 'column', gap: 12 },
  name: { fontFamily: FONTS.displayBold, letterSpacing: 0.2 },
});
