import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Stack } from 'expo-router';
import { Drawer } from 'react-native-drawer-layout';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, usePathname, useNavigation } from 'expo-router';
import type { NavigationState } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { APP_VERSION } from '../../constants/app-version';
import { useAuth } from '../../hooks/useAuth';
import { meApi, type MeMailbox } from '../../lib/api';
import { MailboxSessionSync } from '../../components/MailboxSessionSync';
import { WorkspacePrefetchSync } from '../../components/WorkspacePrefetchSync';
import { AndroidBackNavigation, getFocusedStackRouteName } from '../../components/AndroidBackNavigation';
import { resolveSidebarRoleLabel, isAdminUser } from '../../lib/user-role';
import { BrandLogo } from '../../components/BrandLogo';
import { MAILBOX_VIEWS, type MailViewKey } from '../../lib/mail-views';
import type { LabelCount } from '../../lib/gmail-label-counts';
import type { GmailLabel } from '../../lib/api';
import { labelDisplayName } from '../../lib/gmail-labels';
const MODULES = [
  { key: 'inbox',        label: 'Mail',      icon: 'mail-outline' as const,            path: '/(workspace)/inbox',        feature: 'inbox',        googleOnly: false },
  { key: 'calls',        label: 'Calls',     icon: 'call-outline' as const,            path: '/(workspace)/calls',        feature: 'calls',        googleOnly: false },
  { key: 'calendar',     label: 'Calendar',  icon: 'calendar-outline' as const,        path: '/(workspace)/calendar',     feature: 'calendar',     googleOnly: false },
  { key: 'drive',        label: 'Drive',     icon: 'cloud-outline' as const,           path: '/(workspace)/drive',        feature: 'drive',        googleOnly: false },
  { key: 'forms',        label: 'Forms',     icon: 'document-text-outline' as const,   path: '/(workspace)/forms',        feature: 'forms',        googleOnly: false },
  { key: 'broadcasting', label: 'Broadcast', icon: 'megaphone-outline' as const,       path: '/(workspace)/broadcasting', feature: 'broadcasting', googleOnly: false },
  { key: 'whatsapp',     label: 'WhatsApp',  icon: 'logo-whatsapp' as const,           path: '/(workspace)/whatsapp',     feature: 'whatsapp',     googleOnly: false },
  // Team is admin-only (Google OAuth sign-in)
  { key: 'admin',        label: 'Team',      icon: 'shield-checkmark-outline' as const, path: '/(workspace)/admin',       feature: null,           googleOnly: true  },
] as const;

interface DrawerCtx {
  openDrawer: () => void;
  closeDrawer: () => void;
}
export const DrawerContext = createContext<DrawerCtx>({ openDrawer: () => {}, closeDrawer: () => {} });
export function useDrawer() { return useContext(DrawerContext); }

/** Shared mail view — lets the drawer update the inbox screen instantly. */
interface MailViewCtx {
  mailView: MailViewKey;
  setMailView: (v: MailViewKey) => void;
  /** Label counts fed from InboxScreen so the drawer can show badges. */
  labelCounts: Record<string, LabelCount>;
  setLabelCounts: (c: Record<string, LabelCount>) => void;
  /** User-created Gmail labels, fed from InboxScreen. */
  userLabels: GmailLabel[];
  setUserLabels: (labels: GmailLabel[]) => void;
  /** Active label filter (for inbox label filtering). */
  filterLabelId: string | null;
  setFilterLabelId: (id: string | null) => void;
  /** Instant draft count delta — called from ComposeScreen on create/discard. */
  bumpDraftCount: (delta: number) => void;
  /** InboxScreen registers Android back steps (drafts → inbox, label → inbox, etc.). */
  mailInboxBackRef: React.MutableRefObject<(() => boolean) | null>;
}
export const MailViewContext = createContext<MailViewCtx>({
  mailView: 'inbox',
  setMailView: () => {},
  labelCounts: {},
  setLabelCounts: () => {},
  userLabels: [],
  setUserLabels: () => {},
  filterLabelId: null,
  setFilterLabelId: () => {},
  bumpDraftCount: () => {},
  mailInboxBackRef: { current: null },
});
export function useMailView() { return useContext(MailViewContext); }

function SidebarContent({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const { profile, user, signOut, hasFeature } = useAuth();
  const { mailView, setMailView, labelCounts, userLabels, filterLabelId, setFilterLabelId } = useMailView();
  const onInbox = pathname.includes('inbox') && !pathname.includes('compose');
  const [mailExpanded, setMailExpanded] = useState(false);
  const [labelsExpanded, setLabelsExpanded] = useState(false);

  // True only when the user authenticated via Google OAuth.
  // Email-password users have provider = 'email'; Google OAuth users have 'google'.
  const isGoogleUser =
    (user?.app_metadata?.provider === 'google') ||
    ((user?.app_metadata?.providers as string[] | undefined)?.includes('google') ?? false);
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

  const selectMailView = useCallback((view: MailViewKey) => {
    setMailView(view);
    setFilterLabelId(null);
    if (!onInbox) router.push('/(workspace)/inbox' as any);
    onClose();
  }, [setMailView, setFilterLabelId, onInbox, router, onClose]);

  const selectLabel = useCallback((id: string) => {
    // Labels always show inside Inbox view
    setMailView('inbox');
    setFilterLabelId(id);
    if (!onInbox) router.push('/(workspace)/inbox' as any);
    onClose();
  }, [setMailView, setFilterLabelId, onInbox, router, onClose]);

  return (
    <View style={[styles.sidebar, { paddingTop: insets.top }]}>
      <View style={styles.sidebarHeader}>
        <BrandLogo size="sm" nameColor={Colors.sidebarActiveText} />
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
          const role = resolveSidebarRoleLabel(
            profile?.role,
            me?.groupName ?? profile?.group_name,
          );
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
          // Team is visible to Google OAuth admins only
          if (mod.key === 'admin' && !isAdminUser(profile?.role)) return null;
          // googleOnly modules are hidden for email-login users
          if (mod.googleOnly && !isGoogleUser) return null;
          const allowed = mod.feature === null || hasFeature(mod.feature);
          if (!allowed) return null;
          const active = pathname.includes(mod.key);

          if (mod.key === 'inbox') {
            const inboxUnread = labelCounts['INBOX']?.unread ?? 0;
            return (
              <React.Fragment key="inbox">
                {/* Inbox parent row — tapping always goes to inbox main */}
                <TouchableOpacity
                  style={[styles.navItem, onInbox && mailView === 'inbox' && styles.navItemActive]}
                  onPress={() => selectMailView('inbox')}
                >
                  <Ionicons
                    name="mail-outline"
                    size={20}
                    color={onInbox && mailView === 'inbox' ? Colors.sidebarActiveText : Colors.sidebarText}
                  />
                  <Text style={[styles.navLabel, onInbox && mailView === 'inbox' && styles.navLabelActive]} numberOfLines={1}>
                    Mail
                  </Text>
                  {inboxUnread > 0 && (
                    <View style={styles.navBadge}>
                      <Text style={styles.navBadgeText}>{inboxUnread > 99 ? '99+' : inboxUnread}</Text>
                    </View>
                  )}
                  <TouchableOpacity
                    onPress={() => setMailExpanded((v) => !v)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={styles.expandBtn}
                  >
                    <Ionicons
                      name={mailExpanded ? 'chevron-up' : 'chevron-down'}
                      size={16}
                      color={Colors.sidebarText}
                    />
                  </TouchableOpacity>
                </TouchableOpacity>

                {/* Mail sub-items — all views except Inbox itself */}
                {mailExpanded && (
                  <>
                    {MAILBOX_VIEWS.filter((v) => v.key !== 'inbox').map((view) => {
                      const subActive = onInbox && mailView === view.key && !filterLabelId;
                      const count = labelCounts[view.badgeLabelId];
                      const badge = view.badgeLabelId && count
                        ? (view.key === 'starred' || view.key === 'important' ? count.total : count.unread)
                        : 0;
                      return (
                        <TouchableOpacity
                          key={view.key}
                          style={[styles.navSubItem, subActive && styles.navSubItemActive]}
                          onPress={() => selectMailView(view.key)}
                        >
                          <Ionicons
                            name={view.icon}
                            size={18}
                            color={subActive ? Colors.sidebarActiveText : Colors.sidebarText}
                          />
                          <Text style={[styles.navSubLabel, subActive && styles.navLabelActive]} numberOfLines={1}>
                            {view.label}
                          </Text>
                          {badge > 0 && (
                            <View style={[styles.navBadge, subActive && styles.navBadgeActive]}>
                              <Text style={styles.navBadgeText}>{badge > 99 ? '99+' : badge}</Text>
                            </View>
                          )}
                        </TouchableOpacity>
                      );
                    })}

                    {/* Labels sub-section — nested under Inbox, same as Gmail */}
                    {userLabels.length > 0 && (
                      <>
                        <TouchableOpacity
                          style={styles.navSubSectionHeader}
                          onPress={() => setLabelsExpanded((v) => !v)}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.navSectionTitle}>Labels</Text>
                          <Ionicons
                            name={labelsExpanded ? 'chevron-up' : 'chevron-down'}
                            size={13}
                            color={Colors.sidebarText}
                            style={{ opacity: 0.7 }}
                          />
                        </TouchableOpacity>

                        {labelsExpanded && userLabels.map((label) => {
                          const unread = labelCounts[label.id]?.unread ?? 0;
                          const labelActive = onInbox && filterLabelId === label.id;
                          return (
                            <TouchableOpacity
                              key={label.id}
                              style={[styles.navSubItem, labelActive && styles.navSubItemActive]}
                              onPress={() => selectLabel(label.id)}
                            >
                              <Ionicons
                                name="pricetag-outline"
                                size={16}
                                color={labelActive ? Colors.sidebarActiveText : Colors.sidebarText}
                              />
                              <Text style={[styles.navSubLabel, labelActive && styles.navLabelActive]} numberOfLines={1}>
                                {labelDisplayName(label)}
                              </Text>
                              {unread > 0 && (
                                <View style={[styles.navBadge, labelActive && styles.navBadgeActive]}>
                                  <Text style={styles.navBadgeText}>{unread > 99 ? '99+' : unread}</Text>
                                </View>
                              )}
                            </TouchableOpacity>
                          );
                        })}
                      </>
                    )}
                  </>
                )}
              </React.Fragment>
            );
          }

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

      <View style={[styles.sidebarFooter, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        <Text style={styles.versionText}>v{APP_VERSION}</Text>
      </View>

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
  const [mailView, setMailView] = useState<MailViewKey>('inbox');
  const [labelCounts, setLabelCounts] = useState<Record<string, LabelCount>>({});
  const [userLabels, setUserLabels] = useState<GmailLabel[]>([]);
  const [filterLabelId, setFilterLabelId] = useState<string | null>(null);
  const mailInboxBackRef = useRef<(() => boolean) | null>(null);

  const bumpDraftCount = useCallback((delta: number) => {
    setLabelCounts((prev) => {
      const cur = prev['DRAFT'] ?? { total: 0, unread: 0 };
      return { ...prev, DRAFT: { total: Math.max(0, cur.total + delta), unread: cur.unread } };
    });
  }, []);

  const openDrawer = () => setOpen(true);
  const closeDrawer = () => setOpen(false);
  const pathname = usePathname();
  const navigation = useNavigation();
  const [focusedRoute, setFocusedRoute] = useState<string | null>('inbox/index');

  useEffect(() => {
    const syncRoute = () => {
      setFocusedRoute(getFocusedStackRouteName(navigation.getState() as NavigationState));
    };
    syncRoute();
    return navigation.addListener('state', syncRoute);
  }, [navigation]);

  return (
    <MailViewContext.Provider value={{ mailView, setMailView, labelCounts, setLabelCounts, userLabels, setUserLabels, filterLabelId, setFilterLabelId, bumpDraftCount, mailInboxBackRef }}>
    <DrawerContext.Provider value={{ openDrawer, closeDrawer }}>
      <MailboxSessionSync />
      <WorkspacePrefetchSync />
      <AndroidBackNavigation
        drawerOpen={open}
        closeDrawer={closeDrawer}
        pathname={pathname}
        routeName={focusedRoute}
        mailInboxBackRef={mailInboxBackRef}
      />
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
          <Stack.Screen name="calls/index" />
          <Stack.Screen name="calls/[id]" />
          <Stack.Screen name="calendar/index" />
          <Stack.Screen name="meetings/index" />
          <Stack.Screen name="meetings/[id]" />
          <Stack.Screen name="drive/index" />
          <Stack.Screen name="forms/index" />
          <Stack.Screen name="forms/[formId]/edit" />
          <Stack.Screen name="broadcasting/index" />
          <Stack.Screen name="dashboard/index" />
          <Stack.Screen name="admin/index" />
          <Stack.Screen name="admin/add" />
          <Stack.Screen name="admin/member/[userId]" />
          <Stack.Screen name="admin/analytics/index" />
          <Stack.Screen name="admin/analytics/[userId]" />
        </Stack>
      </Drawer>
    </DrawerContext.Provider>
    </MailViewContext.Provider>
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
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: Colors.sidebarText,
  },
  navLabelActive: { color: Colors.sidebarActiveText, fontWeight: '600' },
  expandBtn: {
    padding: 4,
    marginLeft: 'auto',
  },
  navBadge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBadgeActive: {
    backgroundColor: Colors.primary,
  },
  navBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.sidebarActiveText,
  },
  navSubItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 38,
    paddingRight: 14,
    paddingVertical: 9,
    borderRadius: 10,
    marginBottom: 1,
  },
  navSubItemActive: { backgroundColor: 'rgba(255,255,255,0.15)' },
  navSubLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: '400',
    color: Colors.sidebarText,
  },
  navSubSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 38,
    paddingRight: 14,
    paddingTop: 12,
    paddingBottom: 4,
  },
  navSectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.sidebarText,
    letterSpacing: 0.2,
    opacity: 0.9,
  },
  sidebarFooter: {
    paddingHorizontal: 20,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  versionText: {
    color: Colors.sidebarText,
    fontSize: 11,
    opacity: 0.55,
    letterSpacing: 0.3,
  },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  signOutText: {
    color: Colors.sidebarText,
    fontSize: 14,
    fontWeight: '500',
  },
});
