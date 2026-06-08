import React from 'react';
import { View, Text, Image, StyleSheet, type ImageStyle, type ViewStyle } from 'react-native';
import { APP_NAME, APP_LOGO } from '../constants/branding';

type Size = 'sm' | 'md' | 'lg';

const SIZES: Record<Size, { image: number; font: number }> = {
  sm: { image: 28, font: 16 },
  md: { image: 56, font: 22 },
  lg: { image: 80, font: 28 },
};

type Props = {
  size?: Size;
  layout?: 'row' | 'column';
  showName?: boolean;
  nameColor?: string;
  style?: ViewStyle;
  imageStyle?: ImageStyle;
};

export function BrandLogo({
  size = 'md',
  layout = 'row',
  showName = true,
  nameColor = '#FFFFFF',
  style,
  imageStyle,
}: Props) {
  const dims = SIZES[size];
  return (
    <View style={[styles.row, layout === 'column' && styles.column, style]}>
      <Image
        source={APP_LOGO}
        style={[
          {
            width: dims.image,
            height: dims.image,
            borderRadius: size === 'sm' ? 6 : 12,
          },
          imageStyle,
        ]}
        resizeMode="contain"
        accessibilityLabel={`${APP_NAME} logo`}
      />
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
  name: { fontWeight: '700', letterSpacing: 0.2 },
});
