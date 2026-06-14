import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ScreenHeader from '../../../components/ScreenHeader';
import EmptyState from '../../../components/EmptyState';
import Badge from '../../../components/Badge';
import { AdminGroupsPanel } from '../../../components/AdminGroupsPanel';
import { useDrawer } from '../_layout';
import { adminApi } from '../../../lib/api';
import {
  teamMemberLabel,
  teamMemberSubtitle,
  type AdminTeamGroup,
  type AdminTeamMember,
} from '../../../lib/admin-team';
import { isAdminUser } from '../../../lib/user-role';
import { useAuth } from '../../../hooks/useAuth';
import { Colors } from '../../../constants/colors';

const ROLE_COLORS: Record<string, { bg: string; text: string }> = {
  admin: { bg: '#EDE9FE', text: Colors.primary },
  staff: { bg: '#D1FAE5', text: '#065F46' },
  committee: { bg: '#FEF3C7', text: '#92400E' },
};

export default function AdminScreen() {
  const router = useRouter();
  const { openDrawer } = useDrawer();
  const { profile } = useAuth();
  const [members, setMembers] = useState<AdminTeamMember[]>([]);
  const [groups, setGroups] = useState<AdminTeamGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    setLoadError(null);
    try {
      const [teamData, groupsData] = await Promise.all([
        adminApi.listTeam(),
        adminApi.listGroups().catch(() => ({ groups: [] as AdminTeamGroup[] })),
      ]);
      setMembers((teamData.members ?? []).filter((m) => m.role !== 'admin'));
      setGroups(groupsData.groups ?? []);
    } catch (e: unknown) {
      setMembers([]);
      setLoadError(e instanceof Error ? e.message : 'Could not load team members');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void loadMembers(); }, [loadMembers]);

  if (!isAdminUser(profile?.role)) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Team" onMenuPress={openDrawer} />
        <EmptyState icon="lock-closed-outline" title="Admin Access Required" subtitle="Only admins can manage team members." />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Team"
        onMenuPress={openDrawer}
        rightAction={{ icon: 'stats-chart-outline', onPress: () => router.push('/(workspace)/admin/analytics' as any) }}
      />

      <FlatList
        data={members}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <>
            <AdminGroupsPanel
              groups={groups}
              loading={loading}
              onRefresh={loadMembers}
            />
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Team & shared mailbox</Text>
              <TouchableOpacity
                style={styles.addBtn}
                onPress={() => router.push('/(workspace)/admin/add' as any)}
              >
                <Ionicons name="person-add-outline" size={16} color={Colors.primary} />
                <Text style={styles.addBtnText}>Add staff member</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.sectionSubtitle}>Existing members</Text>
          </>
        }
        renderItem={({ item }) => (
          <MemberRow
            member={item}
            onPress={() => router.push(`/(workspace)/admin/member/${item.id}` as any)}
            onAnalytics={() => router.push(`/(workspace)/admin/analytics/${item.id}` as any)}
          />
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); void loadMembers(); }}
            tintColor={Colors.primary}
          />
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>
          ) : loadError ? (
            <View style={styles.center}>
              <EmptyState icon="cloud-offline-outline" title="Could not load team" subtitle={loadError} />
              <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); void loadMembers(); }}>
                <Text style={styles.retryBtnText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <EmptyState icon="people-outline" title="No members added yet." subtitle="Add your first team member" />
          )
        }
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

function MemberRow({
  member,
  onPress,
  onAnalytics,
}: {
  member: AdminTeamMember;
  onPress: () => void;
  onAnalytics: () => void;
}) {
  const rc = ROLE_COLORS[member.role] ?? { bg: Colors.border, text: Colors.textSecondary };
  const label = teamMemberLabel(member);
  const subtitle = teamMemberSubtitle(member);

  return (
    <TouchableOpacity style={styles.memberCard} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.memberAvatar}>
        <Text style={styles.memberAvatarText}>{label.charAt(0).toUpperCase()}</Text>
      </View>
      <View style={styles.memberInfo}>
        <Text style={styles.memberName} numberOfLines={1}>{label}</Text>
        <Text style={styles.memberEmail} numberOfLines={2}>{subtitle}</Text>
        {member.jobTitle ? (
          <Text style={styles.memberMeta} numberOfLines={1}>{member.jobTitle}</Text>
        ) : null}
        <Badge label={member.groupName ?? 'Full access'} bgColor={rc.bg} color={rc.text} />
      </View>
      <TouchableOpacity onPress={onAnalytics} style={styles.actionBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="stats-chart-outline" size={18} color={Colors.textSecondary} />
      </TouchableOpacity>
      <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { paddingVertical: 32, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingBottom: 24, flexGrow: 1 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
    gap: 12,
  },
  sectionTitle: { flex: 1, fontSize: 18, fontWeight: '700', color: Colors.text },
  sectionSubtitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textSecondary,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.primaryLight,
  },
  addBtnText: { fontSize: 13, fontWeight: '600', color: Colors.primary },
  memberCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 12,
    marginBottom: 10,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 4,
    elevation: 2,
  },
  memberAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarText: { fontSize: 18, fontWeight: '700', color: Colors.primary },
  memberInfo: { flex: 1, gap: 3 },
  memberName: { fontSize: 14, fontWeight: '700', color: Colors.text },
  memberEmail: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },
  memberMeta: { fontSize: 11, color: Colors.textMuted },
  actionBtn: { padding: 4 },
  retryBtn: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: Colors.primary,
  },
  retryBtnText: { color: Colors.surface, fontWeight: '600', fontSize: 14 },
});
