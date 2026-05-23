import React, { createContext, useContext, useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { Drawer } from 'react-native-drawer-layout';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { useAuth } from '../../hooks/useAuth';
import { meApi, type MeMailbox } from '../../lib/api';
import { MailboxSessionSync } from '../../components/MailboxSessionSync';

const MODULES = [
  { key: 'inbox', label: 'Inbox', icon: 'mail-outline' as const, path: '/(workspace)/inbox', feature: 'inbox' },
  { key: 'crm', label: 'CRM', icon: 'people-outline' as const, path: '/(workspace)/crm', feature: 'crm' },
  { key: 'calls', label: 'Calls', icon: 'call-outline' as const, path: '/(workspace)/calls', feature: 'calls' },
  { key: 'sms', label: 'SMS', icon: 'chatbubble-outline' as const, path: '/(workspace)/sms', feature: 'sms' },
  { key: 'whatsapp', label: 'WhatsApp', icon: 'logo-whatsapp' as const, path: '/(workspace)/whatsapp', feature: 'whatsapp' },
  { key: 'calendar', label: 'Calendar', icon: 'calendar-outline' as const, path: '/(workspace)/calendar', feature: 'calendar' },
  { key: 'meetings', label: 'Meetings', icon: 'videocam-outline' as const, path: '/(workspace)/meetings', feature: 'meetings' },
  { key: 'drive', label: 'Drive', icon: 'cloud-outline' as const, path: '/(workspace)/drive', feature: 'drive' },
  { key: 'forms', label: 'Forms', icon: 'document-text-outline' as const, path: '/(workspace)/forms', feature: 'forms' },
  { key: 'broadcasting', label: 'Broadcast', icon: 'megaphone-outline' as const, path: '/(workspace)/broadcasting', feature: 'broadcasting' },
  { key: 'dashboard', label: 'Dashboard', icon: 'analytics-outline' as const, path: '/(workspace)/dashboard', feature: 'dashboard' },
  { key: 'admin', label: 'Team', icon: 'shield-checkmark-outline' as const, path: '/(workspace)/admin', feature: null },
] as const;

interface DrawerCtx {
  openDrawer: () => void;
  closeDrawer: () => void;
}
export const DrawerContext = createContext<DrawerCtx>({ openDrawer: () => {}, closeDrawer: () => {} });
export function useDrawer() { return useContext(DrawerContext); }

function SidebarContent({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const { profile, user, signOut, hasFeature } = useAuth();
  const [me, setMe] = useState<MeMailbox | null>(null);

  useEffect(() => {
    if (!user) { setMe(null); return; }
    let cancelled = false;
    meApi.mailbox()
      .then((data) => { if (!cancelled) setMe(data); })
      .catch(() => { /* keep null; we'll fall back to auth user */ });
    return () => { cancelled = true; };
  }, [user?.id]);

  const navigate = (path: string) => {
    onClose();
    router.push(path as any);
  };

  return (
    <View style={[styles.sidebar, { paddingTop: insets.top }]}>
      <View style={styles.sidebarHeader}>
        <View style={styles.logoRow}>
          <View style={styles.logoBox}>
            <Ionicons name="briefcase" size={20} color={Colors.surface} />
          </View>
          <Text style={styles.logoText}>PlaceCom</Text>
        </View>
        {(profile || user || me) && (() => {
          // Multi-source fallback for the signed-in user's name + email
          const meta = (user?.user_metadata ?? {}) as { full_name?: string; name?: string; email?: string };
          const sessionEmail = me?.sessionEmail || profile?.email || user?.email || meta.email || '';
          const emailName = sessionEmail ? sessionEmail.split('@')[0] : '';
          const friendlyName =
            (me?.displayUsername && me.displayUsername.trim()) ||
            (profile?.display_name && profile.display_name.trim()) ||
            (meta.full_name && meta.full_name.trim()) ||
            (meta.name && meta.name.trim()) ||
            (emailName ? emailName.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '') ||
            'User';
          const avatarLetter = (friendlyName || sessionEmail || '?').charAt(0).toUpperCase();
          const role = me?.role || profile?.role;
          // Mailbox email — for staff this is the admin's Gmail being used to send/read mail.
          // For admin role it's the same as their own connected Gmail.
          const mailboxEmail = me?.mailboxEmail || '';
          const isDifferentMailbox =
            mailboxEmail && sessionEmail && mailboxEmail.toLowerCase() !== sessionEmail.toLowerCase();
          return (
            <View style={styles.userInfo}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{avatarLetter}</Text>
              </View>
              <View style={styles.userDetails}>
                <Text style={styles.userName} numberOfLines={1}>{friendlyName}</Text>
                {sessionEmail ? (
                  <Text style={styles.userEmail} numberOfLines={1}>{sessionEmail}</Text>
                ) : null}
                {mailboxEmail ? (
                  <View style={styles.mailboxRow}>
                    <Ionicons name="mail-outline" size={11} color={Colors.sidebarText} />
                    <Text style={styles.mailboxText} numberOfLines={1}>
                      {isDifferentMailbox ? `via ${mailboxEmail}` : mailboxEmail}
                    </Text>
                  </View>
                ) : null}
                {role ? <Text style={styles.userRole}>{role}</Text> : null}
              </View>
            </View>
          );
        })()}
      </View>

      <ScrollView style={styles.navList} showsVerticalScrollIndicator={false}>
        {MODULES.map((mod) => {
          const allowed = mod.feature === null || hasFeature(mod.feature);
          if (!allowed) return null;
          const active = pathname.includes(mod.key);
          return (
            <TouchableOpacity
              key={mod.key}
              style={[styles.navItem, active && styles.navItemActive]}
              onPress={() => navigate(mod.path)}
            >
              <Ionicons
                name={mod.icon}
                size={20}
                color={active ? Colors.sidebarActiveText : Colors.sidebarText}
              />
              <Text style={[styles.navLabel, active && styles.navLabelActive]}>{mod.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <TouchableOpacity
        style={styles.signOutBtn}
        onPress={async () => { onClose(); await signOut(); }}
      >
        <Ionicons name="log-out-outline" size={20} color={Colors.sidebarText} />
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function WorkspaceLayout() {
  const [open, setOpen] = useState(false);

  const openDrawer = () => setOpen(true);
  const closeDrawer = () => setOpen(false);

  return (
    <DrawerContext.Provider value={{ openDrawer, closeDrawer }}>
      <MailboxSessionSync />
      <Drawer
        open={open}
        onOpen={() => setOpen(true)}
        onClose={() => setOpen(false)}
        drawerPosition="left"
        drawerType="front"
        drawerStyle={{ width: 280 }}
        overlayStyle={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
        renderDrawerContent={() => <SidebarContent onClose={closeDrawer} />}
      >
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="inbox/index" />
          <Stack.Screen name="inbox/[id]" />
          <Stack.Screen name="inbox/compose" />
          <Stack.Screen name="crm/index" />
          <Stack.Screen name="crm/[id]" />
          <Stack.Screen name="calls/index" />
          <Stack.Screen name="calls/[id]" />
          <Stack.Screen name="sms/index" />
          <Stack.Screen name="sms/[peer]" />
          <Stack.Screen name="whatsapp/index" />
          <Stack.Screen name="whatsapp/[peer]" />
          <Stack.Screen name="calendar/index" />
          <Stack.Screen name="meetings/index" />
          <Stack.Screen name="meetings/[id]" />
          <Stack.Screen name="drive/index" />
          <Stack.Screen name="forms/index" />
          <Stack.Screen name="forms/[formId]/edit" />
          <Stack.Screen name="broadcasting/index" />
          <Stack.Screen name="dashboard/index" />
          <Stack.Screen name="admin/index" />
        </Stack>
      </Drawer>
    </DrawerContext.Provider>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    flex: 1,
    backgroundColor: Colors.sidebar,
  },
  sidebarHeader: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
    gap: 16,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.surface,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: Colors.surface,
    fontSize: 16,
    fontWeight: '700',
  },
  userDetails: { flex: 1 },
  userName: {
    color: Colors.surface,
    fontSize: 14,
    fontWeight: '600',
  },
  userEmail: {
    color: Colors.sidebarText,
    fontSize: 11,
    marginTop: 1,
  },
  mailboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  mailboxText: {
    color: Colors.sidebarText,
    fontSize: 10,
    opacity: 0.85,
    flex: 1,
  },
  userRole: {
    color: Colors.sidebarText,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 2,
    opacity: 0.7,
  },
  navList: { flex: 1, padding: 12 },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 10,
    marginBottom: 2,
  },
  navItemActive: { backgroundColor: Colors.primary },
  navLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.sidebarText,
  },
  navLabelActive: { color: Colors.sidebarActiveText, fontWeight: '600' },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  signOutText: {
    color: Colors.sidebarText,
    fontSize: 14,
    fontWeight: '500',
  },
});
