import { Platform, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Reliable insets when edge-to-edge is enabled (Android may report 0 from context briefly). */
export function useAppInsets() {
  const insets = useSafeAreaInsets();
  const androidStatusBar =
    Platform.OS === 'android' ? (StatusBar.currentHeight ?? 28) : 0;
  const top = insets.top > 0 ? insets.top : androidStatusBar;
  const bottom = insets.bottom;
  return { top, bottom, left: insets.left, right: insets.right };
}
