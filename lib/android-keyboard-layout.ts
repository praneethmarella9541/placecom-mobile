import Constants from 'expo-constants';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { isExpoGo } from './expo-runtime';

/**
 * Production APKs (edge-to-edge + pan) need the composer lifted via keyboard
 * height. Expo Go / dev builds keep adjustResize — manual inset would double-offset.
 */
export function androidUsesManualKeyboardInset(): boolean {
  if (Platform.OS !== 'android' || isExpoGo()) return false;
  return Constants.expoConfig?.extra?.androidManualKeyboard === true;
}

/** Bottom padding for chat-style composer bars. */
export function chatComposerBottomInset(keyboardHeight: number, safeBottom: number): number {
  if (Platform.OS === 'ios') {
    return keyboardHeight > 0 ? 0 : safeBottom;
  }
  if (androidUsesManualKeyboardInset()) {
    return keyboardHeight > 0 ? keyboardHeight : safeBottom;
  }
  return keyboardHeight > 0 ? 0 : safeBottom;
}

export const ChatScreenWrapper =
  Platform.OS === 'ios'
    ? KeyboardAvoidingView
    : androidUsesManualKeyboardInset()
      ? View
      : KeyboardAvoidingView;

export function chatScreenWrapperProps(): Record<string, unknown> {
  if (Platform.OS === 'ios') {
    return { behavior: 'padding' as const, keyboardVerticalOffset: 0 };
  }
  if (androidUsesManualKeyboardInset()) {
    return {};
  }
  return { behavior: undefined, keyboardVerticalOffset: 0 };
}
