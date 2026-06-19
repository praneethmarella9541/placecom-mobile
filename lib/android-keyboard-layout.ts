import { KeyboardAvoidingView as RNKeyboardAvoidingView, Platform } from 'react-native';
import { KeyboardAvoidingView as KCKeyboardAvoidingView } from 'react-native-keyboard-controller';
import { isExpoGo } from './expo-runtime';

/**
 * Chat keyboard handling is delegated to react-native-keyboard-controller, which
 * tracks the IME via Android's WindowInsetsAnimation (and the iOS equivalent) and
 * lifts the composer frame-by-frame above the keyboard — the native WhatsApp feel.
 *
 * keyboard-controller ships native code, so it is unavailable in Expo Go. There we
 * fall back to the system's adjustResize + RN KeyboardAvoidingView. Real builds
 * (dev client / APK) use keyboard-controller. Requires <KeyboardProvider> at root.
 */
const useKeyboardController = !isExpoGo();

/**
 * Bottom padding for chat-style composer bars. KeyboardAvoidingView (or system
 * resize in Expo Go) handles the keyboard lift, so we only manage the resting
 * safe-area inset — collapsed to 0 while the keyboard is up so the composer sits
 * flush on the keyboard.
 */
export function chatComposerBottomInset(keyboardHeight: number, safeBottom: number): number {
  return keyboardHeight > 0 ? 0 : safeBottom;
}

export const ChatScreenWrapper = useKeyboardController
  ? KCKeyboardAvoidingView
  : RNKeyboardAvoidingView;

export function chatScreenWrapperProps(): Record<string, unknown> {
  // "padding" keeps the header pinned and shrinks the flex message list while the
  // composer rises — the predictable layout for a header + list + composer column.
  if (useKeyboardController) {
    return { behavior: 'padding' as const, keyboardVerticalOffset: 0 };
  }
  // Expo Go: iOS needs KeyboardAvoidingView padding; Android relies on the system
  // adjustResize shrinking the window (RN KAV with no behavior would double-lift).
  if (Platform.OS === 'ios') {
    return { behavior: 'padding' as const, keyboardVerticalOffset: 0 };
  }
  return { behavior: undefined, keyboardVerticalOffset: 0 };
}
