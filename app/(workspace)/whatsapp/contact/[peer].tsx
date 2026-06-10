import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Image,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { whatsappApi } from '../../../../lib/api';
import { useAuth } from '../../../../hooks/useAuth';
import { useWhatsAppContacts } from '../../../../hooks/useWhatsAppContacts';
import type { WhatsAppMessage } from '../../../../lib/whatsapp-types';
import { normalizePhone } from '../../../../lib/phone';
import {
  displayNameForPeer,
  formatWhatsAppPhone,
  peerInitials,
} from '../../../../lib/whatsapp-utils';
import { normalizeWhatsAppMessages } from '../../../../lib/whatsapp-message-normalize';
import {
  categorizeWhatsAppMedia,
  mediaFilenameFromMessage,
  type WhatsAppMediaCategory,
} from '../../../../lib/whatsapp-media-helpers';
import { resolveWhatsAppMediaUrl, whatsAppMediaSource } from '../../../../lib/whatsapp-media';
import { WhatsAppMediaViewer } from '../../../../components/whatsapp/WhatsAppMediaViewer';
import { Colors } from '../../../../constants/colors';

const TABS: { id: WhatsAppMediaCategory; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'image', label: 'Photos', icon: 'images-outline' },
  { id: 'video', label: 'Videos', icon: 'videocam-outline' },
  { id: 'document', label: 'Docs', icon: 'document-text-outline' },
];

export default function WhatsAppContactMediaScreen() {
  const { peer } = useLocalSearchParams<{ peer: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { contacts } = useWhatsAppContacts();
  const { session } = useAuth();
  const authToken = session?.access_token ?? null;

  const peerDecoded = normalizePhone(decodeURIComponent(peer ?? ''));
  const displayName = displayNameForPeer(peerDecoded, contacts);

  const [tab, setTab] = useState<WhatsAppMediaCategory>('image');
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewerMessage, setViewerMessage] = useState<WhatsAppMessage | null>(null);

  const tileSize = Math.floor((width - 6) / 3);

  const load = useCallback(async () => {
    try {
      const data = await whatsappApi.getMessages(peerDecoded);
      setMessages(normalizeWhatsAppMessages(data.messages ?? []));
    } catch {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [peerDecoded]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const mediaByTab = useMemo(() => {
    const buckets: Record<WhatsAppMediaCategory, WhatsAppMessage[]> = {
      image: [],
      video: [],
      audio: [],
      document: [],
    };
    for (const m of messages) {
      const cat = categorizeWhatsAppMedia(m);
      if (cat) buckets[cat].push(m);
    }
    return buckets;
  }, [messages]);

  const items = tab === 'document'
    ? [...mediaByTab.document, ...mediaByTab.audio]
    : mediaByTab[tab];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerAvatar}>
          <Text style={styles.headerAvatarText}>{peerInitials(peerDecoded, displayName)}</Text>
        </View>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {displayName}
          </Text>
          <Text style={styles.headerSub}>{formatWhatsAppPhone(peerDecoded)}</Text>
        </View>
      </View>

      <View style={styles.tabs}>
        {TABS.map((t) => (
          <TouchableOpacity
            key={t.id}
            style={[styles.tab, tab === t.id && styles.tabActive]}
            onPress={() => setTab(t.id)}
          >
            <Ionicons name={t.icon} size={18} color={tab === t.id ? '#075E54' : Colors.textMuted} />
            <Text style={[styles.tabLabel, tab === t.id && styles.tabLabelActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#25D366" size="large" />
        </View>
      ) : (
        <FlatList
          data={items}
          key={tab}
          keyExtractor={(item) => item.id}
          numColumns={tab === 'document' ? 1 : 3}
          contentContainerStyle={items.length ? styles.grid : styles.gridEmpty}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="folder-open-outline" size={48} color={Colors.textMuted} />
              <Text style={styles.emptyText}>No {tab === 'image' ? 'photos' : tab === 'video' ? 'videos' : 'documents'} yet</Text>
            </View>
          }
          renderItem={({ item }) => {
            const uri = resolveWhatsAppMediaUrl(item.media_url);
            const source = whatsAppMediaSource(uri, authToken);

            if (tab === 'document') {
              return (
                <TouchableOpacity style={styles.docRow} onPress={() => setViewerMessage(item)}>
                  <Ionicons name="document-text-outline" size={28} color="#075E54" />
                  <View style={styles.docBody}>
                    <Text style={styles.docName} numberOfLines={2}>
                      {mediaFilenameFromMessage(item)}
                    </Text>
                    <Text style={styles.docSub}>{item.body?.trim() || 'Document'}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
                </TouchableOpacity>
              );
            }

            return (
              <TouchableOpacity
                style={[styles.tile, { width: tileSize, height: tileSize }]}
                onPress={() => setViewerMessage(item)}
              >
                {tab === 'image' && source ? (
                  <Image source={source} style={styles.tileImage} resizeMode="cover" />
                ) : (
                  <View style={styles.tileVideo}>
                    <Ionicons name="play-circle" size={36} color="#fff" />
                  </View>
                )}
              </TouchableOpacity>
            );
          }}
        />
      )}

      <WhatsAppMediaViewer
        message={viewerMessage}
        authToken={authToken}
        onClose={() => setViewerMessage(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ECE5DD' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#075E54',
  },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarText: { color: '#fff', fontWeight: '700' },
  headerInfo: { flex: 1, minWidth: 0 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#fff' },
  headerSub: { fontSize: 12, color: 'rgba(255,255,255,0.85)' },
  tabs: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
  },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#25D366' },
  tabLabel: { fontSize: 14, color: Colors.textMuted, fontWeight: '500' },
  tabLabelActive: { color: '#075E54', fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  emptyText: { color: Colors.textMuted, fontSize: 14 },
  grid: { padding: 1 },
  gridEmpty: { flexGrow: 1 },
  tile: { padding: 1 },
  tileImage: { width: '100%', height: '100%', backgroundColor: '#ccc' },
  tileVideo: {
    flex: 1,
    backgroundColor: '#1A237E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: Colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderLight,
  },
  docBody: { flex: 1, minWidth: 0 },
  docName: { fontSize: 15, fontWeight: '600', color: Colors.text },
  docSub: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
});
