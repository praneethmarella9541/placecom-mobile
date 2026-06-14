import React from 'react';
import {
  Modal,
  View,
  Image,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { WhatsAppMessage } from '../../lib/whatsapp-types';
import { resolveWhatsAppMediaUrl, whatsAppMediaSource } from '../../lib/whatsapp-media';

type Props = {
  message: WhatsAppMessage | null;
  authToken?: string | null;
  onClose: () => void;
};

export function WhatsAppImageViewer({ message, authToken, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const mediaUrl = message?.media_url ? resolveWhatsAppMediaUrl(message.media_url) : null;
  const source = whatsAppMediaSource(mediaUrl, authToken);

  return (
    <Modal visible={!!message} transparent animationType="fade" onRequestClose={onClose}>
      <StatusBar barStyle="light-content" />
      <View style={styles.backdrop}>
        <TouchableOpacity
          style={[styles.closeBtn, { top: insets.top + 8 }]}
          onPress={onClose}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="close" size={28} color="#fff" />
        </TouchableOpacity>
        {source ? (
          <Image source={source} style={styles.image} resizeMode="contain" />
        ) : (
          <ActivityIndicator size="large" color="#fff" />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtn: {
    position: 'absolute',
    right: 16,
    zIndex: 2,
    padding: 4,
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
