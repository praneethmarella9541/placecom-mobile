import { useEffect, useState } from 'react';
import { Dimensions, Keyboard, Platform, type KeyboardEvent } from 'react-native';
import { androidUsesManualKeyboardInset } from '../lib/android-keyboard-layout';

/**
 * Height of the on-screen keyboard (0 when hidden).
 * Used to pin accessory toolbars directly above the keyboard — the usual pattern
 * for rich editors (Gmail, Slack, WhatsApp) since WebView does not participate in
 * KeyboardAvoidingView the way TextInput does.
 */
export function useKeyboardHeight() {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = (e: KeyboardEvent) => {
      if (Platform.OS === 'android') {
        if (androidUsesManualKeyboardInset()) {
          setHeight(Math.max(0, e.endCoordinates.height));
        } else {
          const windowHeight = Dimensions.get('window').height;
          const keyboardTop = e.endCoordinates.screenY;
          setHeight(Math.max(0, windowHeight - keyboardTop));
        }
        return;
      }
      const windowHeight = Dimensions.get('window').height;
      const keyboardTop = e.endCoordinates.screenY;
      setHeight(Math.max(0, windowHeight - keyboardTop));
    };
    const onHide = () => setHeight(0);

    const showSub = Keyboard.addListener(showEvent, onShow);
    const hideSub = Keyboard.addListener(hideEvent, onHide);
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return height;
}
