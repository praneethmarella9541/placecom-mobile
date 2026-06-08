import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Pressable,
} from 'react-native';
import { WHATSAPP_EMOJI_CATEGORIES } from '../../lib/whatsapp-emojis';
import { Colors } from '../../constants/colors';

type Props = {
  visible: boolean;
  onPick: (emoji: string) => void;
  onClose: () => void;
  height?: number;
};

export function WhatsAppEmojiPicker({ visible, onPick, onClose, height = 280 }: Props) {
  const [tab, setTab] = useState(WHATSAPP_EMOJI_CATEGORIES[0].id);

  if (!visible) return null;

  const category =
    WHATSAPP_EMOJI_CATEGORIES.find((c) => c.id === tab) ?? WHATSAPP_EMOJI_CATEGORIES[0];

  return (
    <View style={[styles.panel, { height }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabs}
        contentContainerStyle={styles.tabsContent}
      >
        {WHATSAPP_EMOJI_CATEGORIES.map((c) => (
          <TouchableOpacity
            key={c.id}
            style={[styles.tab, tab === c.id && styles.tabActive]}
            onPress={() => setTab(c.id)}
          >
            <Text style={[styles.tabText, tab === c.id && styles.tabTextActive]}>{c.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <ScrollView
        style={styles.gridScroll}
        contentContainerStyle={styles.grid}
        keyboardShouldPersistTaps="handled"
      >
        {category.emojis.map((em, idx) => (
          <Pressable
            key={`${tab}-${idx}`}
            style={styles.emojiBtn}
            onPress={() => {
              onPick(em);
            }}
          >
            <Text style={styles.emoji}>{em}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  tabs: {
    maxHeight: 44,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  tabsContent: { paddingHorizontal: 8, paddingVertical: 6, gap: 4 },
  tab: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginRight: 4,
  },
  tabActive: { backgroundColor: '#E7F8EF' },
  tabText: { fontSize: 12, color: Colors.textMuted, fontWeight: '500' },
  tabTextActive: { color: '#075E54', fontWeight: '600' },
  gridScroll: { flex: 1 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 8,
    gap: 2,
  },
  emojiBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  emoji: { fontSize: 26 },
});
