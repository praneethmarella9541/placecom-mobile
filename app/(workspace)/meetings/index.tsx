import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format, formatDistanceToNow } from 'date-fns';
import ScreenHeader from '../../../components/ScreenHeader';
import EmptyState from '../../../components/EmptyState';
import Badge from '../../../components/Badge';
import { useDrawer } from '../_layout';
import { meetingsApi } from '../../../lib/api';
import { Colors } from '../../../constants/colors';

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  completed: { bg: '#D1FAE5', text: '#065F46' },
  processing: { bg: '#DBEAFE', text: '#1E40AF' },
  pending: { bg: '#FEF3C7', text: '#92400E' },
  failed: { bg: '#FEE2E2', text: '#991B1B' },
};

export default function MeetingsScreen() {
  const router = useRouter();
  const { openDrawer } = useDrawer();
  const [meetings, setMeetings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const loadMeetings = useCallback(async () => {
    try {
      const data = await meetingsApi.list();
      setMeetings(data.meetings ?? []);
    } catch {
      setMeetings([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadMeetings(); }, [loadMeetings]);

  async function syncMeetings() {
    setSyncing(true);
    try {
      await meetingsApi.sync();
      await loadMeetings();
      Alert.alert('Synced', 'Meetings synced from Fireflies.');
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Meetings"
        onMenuPress={openDrawer}
        rightAction={{ icon: 'sync-outline', onPress: syncMeetings }}
      />
      {syncing && (
        <View style={styles.syncBanner}>
          <ActivityIndicator size="small" color={Colors.copper} />
          <Text style={styles.syncText}>Syncing meetings from Fireflies...</Text>
        </View>
      )}
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={Colors.copper} /></View>
      ) : (
        <FlatList
          data={meetings}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <MeetingRow meeting={item} onPress={() => router.push(`/(workspace)/meetings/${item.id}` as any)} />
          )}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadMeetings(); }} tintColor={Colors.copper} />}
          ListEmptyComponent={<EmptyState icon="videocam-outline" title="No meetings" subtitle="Sync meetings from Fireflies using the sync button" />}
          contentContainerStyle={meetings.length === 0 ? { flex: 1 } : { paddingBottom: 16 }}
        />
      )}
    </View>
  );
}

function MeetingRow({ meeting, onPress }: { meeting: any; onPress: () => void }) {
  const sc = STATUS_COLORS[meeting.status] ?? { bg: Colors.border, text: Colors.textSecondary };
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.rowIcon}>
        <Ionicons name="videocam-outline" size={20} color={Colors.primary} />
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.meetingTitle} numberOfLines={1}>
            {meeting.meeting_url ?? `Meeting ${meeting.id.slice(0, 8)}`}
          </Text>
          <Badge label={meeting.status} bgColor={sc.bg} color={sc.text} />
        </View>
        <Text style={styles.meetingDate}>
          {meeting.created_at ? formatDistanceToNow(new Date(meeting.created_at), { addSuffix: true }) : ''}
        </Text>
        {meeting.summary && (
          <Text style={styles.meetingSummary} numberOfLines={2}>{meeting.summary}</Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  syncBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center',
  },
  syncText: { fontSize: 13, color: Colors.primary },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  rowBody: { flex: 1, gap: 4 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  meetingTitle: { fontSize: 14, fontWeight: '600', color: Colors.text, flex: 1 },
  meetingDate: { fontSize: 12, color: Colors.textMuted },
  meetingSummary: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
});
