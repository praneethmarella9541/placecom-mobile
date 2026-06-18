import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Image,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
  FlatList,
  Dimensions,
  Text,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { WhatsAppMessage } from '../../lib/whatsapp-types';
import { resolveWhatsAppMediaUrl, whatsAppMediaSource } from '../../lib/whatsapp-media';

const SCREEN_WIDTH = Dimensions.get('window').width;

type Props = {
  messages?: WhatsAppMessage[];
  initialIndex: number;
  authToken?: string | null;
  onClose: () => void;
};

function ImagePage({
  message,
  authToken,
}: {
  message: WhatsAppMessage;
  authToken?: string | null;
}) {
  const mediaUrl = message.media_url ? resolveWhatsAppMediaUrl(message.media_url) : null;
  const source = whatsAppMediaSource(mediaUrl, authToken);
  if (!source) {
    return (
      <View style={styles.page}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }
  return (
    <View style={styles.page}>
      <Image source={source} style={styles.image} resizeMode="contain" />
    </View>
  );
}

export function WhatsAppImageViewer({ messages = [], initialIndex, authToken, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    setCurrentIndex(initialIndex);
  }, [initialIndex, messages]);

  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({
      length: SCREEN_WIDTH,
      offset: SCREEN_WIDTH * index,
      index,
    }),
    []
  );

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 });

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: Array<{ index: number | null }> }) => {
      if (viewableItems[0]?.index != null) {
        setCurrentIndex(viewableItems[0].index);
      }
    },
    []
  );

  const visible = messages.length > 0 && initialIndex >= 0 && initialIndex < messages.length;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <StatusBar barStyle="light-content" />
      <View style={styles.backdrop}>
        <TouchableOpacity
          style={[styles.closeBtn, { top: insets.top + 8 }]}
          onPress={onClose}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="close" size={28} color="#fff" />
        </TouchableOpacity>

        {messages.length > 1 ? (
          <View style={[styles.counter, { top: insets.top + 12 }]} pointerEvents="none">
            <Text style={styles.counterText}>
              {currentIndex + 1} / {messages.length}
            </Text>
          </View>
        ) : null}

        <FlatList
          ref={listRef}
          data={messages}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          getItemLayout={getItemLayout}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <ImagePage message={item} authToken={authToken} />}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig.current}
          windowSize={3}
          maxToRenderPerBatch={3}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: '#000',
  },
  closeBtn: {
    position: 'absolute',
    right: 16,
    zIndex: 2,
    padding: 4,
  },
  counter: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 2,
  },
  counterText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    overflow: 'hidden',
  },
  page: {
    width: SCREEN_WIDTH,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: SCREEN_WIDTH,
    height: '100%',
  },
});
