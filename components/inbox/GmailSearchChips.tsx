import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Keyboard,
  Platform,
  useWindowDimensions,
  type TextInput as RNTextInput,
} from 'react-native';
import type { GmailFolder, GmailLabel, GmailThreadListItem } from '../../lib/api';
import { ingestCorrespondentThreads } from '../../lib/correspondent-rank';
import { gmailApi } from '../../lib/api';
import { Gmail, avatarColorForName } from '../../constants/gmailTheme';
import {
  filterSearchableLabels,
  labelDisplayName,
  labelSearchValue,
} from '../../lib/gmail-labels';
import {
  suggestContactsForOperator,
  type Contact,
  type ContactOperator,
} from '../../lib/gmail-contact-suggestions';
import {
  GMAIL_FILTER_CHIPS,
  ATTACHMENT_FILTER_OPTIONS,
  DATE_FILTER_OPTIONS,
  IS_FILTER_OPTIONS,
  isFilterChipActive,
  getOperatorValue,
  setOperator,
  getAttachmentFilter,
  setAttachmentFilter,
  getDateFilter,
  setDateFilter,
  getIsFilter,
  setIsFilter,
  type GmailFilterChipId,
  type AttachmentFilterValue,
  type DateFilterValue,
  type IsFilterValue,
} from '../../lib/gmail-search';

type Props = {
  visible: boolean;
  search: string;
  onChangeSearch: (next: string) => void;
  userLabels: GmailLabel[];
  folder: GmailFolder;
  threads: GmailThreadListItem[];
  inputRef: React.RefObject<RNTextInput | null>;
  onChipMenuOpenChange?: (open: boolean) => void;
  onMenuSearchFocus?: () => void;
  onDismissKeyboard?: () => void;
};

function contactKey(c: Contact): string {
  return c.email.toLowerCase();
}

const CONTACT_OPERATORS = new Set<ContactOperator>(['from', 'to', 'cc', 'bcc']);

function ContactAvatar({ name, email }: { name: string; email: string }) {
  const initial = (name || email || '?').charAt(0).toUpperCase();
  const bg = avatarColorForName(name || email);
  return (
    <View style={[styles.avatar, { backgroundColor: bg }]}>
      <Text style={styles.avatarText}>{initial}</Text>
    </View>
  );
}

export function GmailSearchChips({
  visible,
  search,
  onChangeSearch,
  userLabels,
  folder,
  threads,
  inputRef,
  onChipMenuOpenChange,
  onMenuSearchFocus,
  onDismissKeyboard,
}: Props) {
  const [openMenu, setOpenMenu] = useState<GmailFilterChipId | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [sentThreads, setSentThreads] = useState<GmailThreadListItem[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [menuQuery, setMenuQuery] = useState('');
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const { height: windowHeight } = useWindowDimensions();

  useEffect(() => {
    if (!visible) {
      setOpenMenu(null);
      setMenuQuery('');
      onChipMenuOpenChange?.(false);
      return;
    }
  }, [visible, onChipMenuOpenChange]);

  useEffect(() => {
    onChipMenuOpenChange?.(openMenu !== null);
  }, [openMenu, onChipMenuOpenChange]);

  useEffect(() => {
    if (!visible || !openMenu || !CONTACT_OPERATORS.has(openMenu as ContactOperator)) {
      return;
    }
    let cancelled = false;
    const q = menuQuery.trim();
    const timer = setTimeout(() => {
      setContactsLoading(true);
      gmailApi
        .getContacts(q.length >= 2 ? { q } : undefined)
        .then((r) => {
          if (!cancelled) setContacts(r.contacts ?? []);
        })
        .catch(() => {
          if (!cancelled) setContacts([]);
        })
        .finally(() => {
          if (!cancelled) setContactsLoading(false);
        });
    }, q.length >= 2 ? 280 : 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [visible, openMenu, menuQuery]);

  useEffect(() => {
    if (threads.length > 0) {
      ingestCorrespondentThreads(threads, folder);
    }
  }, [threads, folder]);

  useEffect(() => {
    if (
      !visible ||
      !openMenu ||
      (openMenu !== 'to' && openMenu !== 'cc' && openMenu !== 'bcc')
    ) {
      return;
    }
    let cancelled = false;
    gmailApi
      .listThreads('sent', { maxResults: 50 })
      .then((r) => {
        if (cancelled) return;
        const list = r.threads ?? [];
        setSentThreads(list);
        ingestCorrespondentThreads(list, 'sent');
      })
      .catch(() => {
        if (!cancelled) setSentThreads([]);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, openMenu]);

  useEffect(() => {
    if (!openMenu) {
      setKeyboardHeight(0);
      return;
    }
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener(hideEvt, () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [openMenu]);

  const labelOptions = useMemo(
    () => filterSearchableLabels(userLabels),
    [userLabels]
  );

  const menuUsesKeyboard = openMenu === 'label' || openMenu === 'from' || openMenu === 'to' || openMenu === 'cc' || openMenu === 'bcc' || openMenu === 'subject';

  const menuScrollMaxHeight = useMemo(() => {
    const base = 280;
    if (!keyboardHeight || !menuUsesKeyboard) return base;
    const reservedTop = 210;
    const available = windowHeight - keyboardHeight - reservedTop;
    return Math.max(140, Math.min(base, available));
  }, [keyboardHeight, menuUsesKeyboard, windowHeight]);

  const filteredContacts = useMemo(() => {
    if (!openMenu || !CONTACT_OPERATORS.has(openMenu as ContactOperator)) return [];
    return suggestContactsForOperator({
      operator: openMenu as ContactOperator,
      query: menuQuery,
      apiContacts: contacts,
      threads,
      sentThreads,
    });
  }, [openMenu, menuQuery, contacts, threads, sentThreads]);

  const filteredLabels = useMemo(() => {
    const q = menuQuery.trim().toLowerCase();
    if (!q) return labelOptions;
    return labelOptions.filter((l) => labelDisplayName(l).toLowerCase().includes(q));
  }, [labelOptions, menuQuery]);

  const activeLabel = getOperatorValue(search, 'label');
  const activeAttachment = getAttachmentFilter(search);
  const activeDate = getDateFilter(search);
  const activeIs = getIsFilter(search);

  if (!visible) return null;

  function toggleMenu(id: GmailFilterChipId) {
    const next = openMenu === id ? null : id;
    onChipMenuOpenChange?.(next !== null);
    setMenuQuery(next ? getMenuSeedQuery(id, search) : '');
    setOpenMenu(next);
  }

  function getMenuSeedQuery(id: GmailFilterChipId, q: string): string {
    switch (id) {
      case 'from':
        return getOperatorValue(q, 'from') ?? '';
      case 'to':
        return getOperatorValue(q, 'to') ?? '';
      case 'cc':
        return getOperatorValue(q, 'cc') ?? '';
      case 'bcc':
        return getOperatorValue(q, 'bcc') ?? '';
      case 'subject':
        return getOperatorValue(q, 'subject') ?? '';
      default:
        return '';
    }
  }

  function focusMenuSearch() {
    onMenuSearchFocus?.();
  }

  function dismissKeyboard() {
    inputRef.current?.blur();
    Keyboard.dismiss();
    onDismissKeyboard?.();
  }

  function applyFilter(next: string) {
    onChangeSearch(next);
    setOpenMenu(null);
    setMenuQuery('');
    dismissKeyboard();
  }

  function pickContact(op: 'from' | 'to' | 'cc' | 'bcc', contact: Contact) {
    applyFilter(setOperator(search, op, contact.email));
  }

  function applyTextOperator(op: 'from' | 'to' | 'cc' | 'bcc' | 'subject') {
    const v = menuQuery.trim();
    if (!v) return;
    applyFilter(setOperator(search, op, v));
  }

  function pickLabel(label: GmailLabel) {
    applyFilter(setOperator(search, 'label', labelSearchValue(label)));
  }

  function pickAttachment(value: AttachmentFilterValue) {
    applyFilter(setAttachmentFilter(search, value));
  }

  function clearAttachment() {
    applyFilter(setAttachmentFilter(search, null));
  }

  function pickDate(value: DateFilterValue) {
    applyFilter(setDateFilter(search, value));
  }

  function pickIs(value: IsFilterValue) {
    applyFilter(setIsFilter(search, value));
  }

  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsRow}
        keyboardShouldPersistTaps="always"
      >
        {GMAIL_FILTER_CHIPS.map((chip) => {
          const active =
            isFilterChipActive(search, chip.id) || openMenu === chip.id;
          return (
            <TouchableOpacity
              key={chip.id}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => toggleMenu(chip.id)}
              activeOpacity={0.7}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {chip.label}
              </Text>
              <Text style={[styles.chevron, active && styles.chipTextActive]}>▾</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {openMenu ? (
        <View
          style={[
            styles.menuPanel,
            { maxHeight: menuUsesKeyboard ? menuScrollMaxHeight + 72 : 340 },
          ]}
        >
          {openMenu === 'label' ? (
            <>
              <View style={styles.menuSearchRow}>
                <TextInput
                  style={styles.menuSearchInput}
                  placeholder="Search labels"
                  placeholderTextColor={Gmail.textMuted}
                  value={menuQuery}
                  onChangeText={setMenuQuery}
                  autoCapitalize="none"
                  autoCorrect={false}
                  onFocus={focusMenuSearch}
                />
              </View>
              <ScrollView
                style={[styles.menuScroll, { maxHeight: menuScrollMaxHeight }]}
                keyboardShouldPersistTaps="always"
                nestedScrollEnabled
                keyboardDismissMode="none"
              >
                {activeLabel ? (
                  <TouchableOpacity
                    style={styles.menuItem}
                    onPress={() => applyFilter(setOperator(search, 'label', null))}
                  >
                    <Text style={styles.menuItemClear}>Clear label filter</Text>
                  </TouchableOpacity>
                ) : null}
                {filteredLabels.map((label) => {
                  const name = labelDisplayName(label);
                  const token = labelSearchValue(label);
                  const selected =
                    activeLabel?.toLowerCase() === name.toLowerCase() ||
                    activeLabel?.toLowerCase() === token.toLowerCase();
                  return (
                    <TouchableOpacity
                      key={label.id}
                      style={[styles.menuItem, selected && styles.menuItemSelected]}
                      onPress={() => pickLabel(label)}
                    >
                      <Text
                        style={[styles.menuItemText, selected && styles.menuItemTextSelected]}
                        numberOfLines={1}
                      >
                        {name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                {filteredLabels.length === 0 ? (
                  <Text style={styles.menuEmpty}>No labels found</Text>
                ) : null}
              </ScrollView>
            </>
          ) : null}

          {openMenu === 'from' || openMenu === 'to' || openMenu === 'cc' || openMenu === 'bcc' ? (
            <>
              <View style={styles.menuSearchRow}>
                <TextInput
                  style={styles.menuSearchInput}
                  placeholder={`Email or name`}
                  placeholderTextColor={Gmail.textMuted}
                  value={menuQuery}
                  onChangeText={setMenuQuery}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  returnKeyType="done"
                  onFocus={focusMenuSearch}
                  onSubmitEditing={() => applyTextOperator(openMenu)}
                />
                {menuQuery.trim().length > 0 ? (
                  <TouchableOpacity
                    style={styles.menuApplyBtn}
                    onPress={() => applyTextOperator(openMenu)}
                  >
                    <Text style={styles.menuApplyText}>Apply</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              <ScrollView
                style={[styles.menuScroll, { maxHeight: menuScrollMaxHeight }]}
                keyboardShouldPersistTaps="always"
                nestedScrollEnabled
                keyboardDismissMode="none"
              >
                {getOperatorValue(search, openMenu) ? (
                  <TouchableOpacity
                    style={styles.menuItem}
                    onPress={() => applyFilter(setOperator(search, openMenu, null))}
                  >
                    <Text style={styles.menuItemClear}>Clear {openMenu} filter</Text>
                  </TouchableOpacity>
                ) : null}
                {contactsLoading && filteredContacts.length === 0 ? (
                  <ActivityIndicator style={styles.menuSpinner} color={Gmail.blue} />
                ) : null}
                {filteredContacts.map((c) => {
                  const selected =
                    getOperatorValue(search, openMenu)?.toLowerCase() ===
                    c.email.toLowerCase();
                  const title = c.displayName || c.email;
                  return (
                    <TouchableOpacity
                      key={contactKey(c)}
                      style={[styles.menuItem, styles.menuItemRow, selected && styles.menuItemSelected]}
                      onPress={() => pickContact(openMenu, c)}
                    >
                      <ContactAvatar name={title} email={c.email} />
                      <View style={styles.menuContactText}>
                        <Text
                          style={[styles.menuItemText, selected && styles.menuItemTextSelected]}
                          numberOfLines={1}
                        >
                          {title}
                        </Text>
                        {c.displayName ? (
                          <Text style={styles.menuItemSub} numberOfLines={1}>
                            {c.email}
                          </Text>
                        ) : null}
                      </View>
                    </TouchableOpacity>
                  );
                })}
                {!contactsLoading && filteredContacts.length === 0 ? (
                  <Text style={styles.menuEmpty}>
                    {menuQuery.trim()
                      ? 'No matches — tap Apply to use this address'
                      : openMenu === 'from'
                        ? 'Type a name or email, or load more inbox threads for recent senders'
                        : 'Type a name or email to search your contacts'}
                  </Text>
                ) : null}
              </ScrollView>
            </>
          ) : null}

          {openMenu === 'subject' ? (
            <>
              <View style={styles.menuSearchRow}>
                <TextInput
                  style={styles.menuSearchInput}
                  placeholder="Subject contains"
                  placeholderTextColor={Gmail.textMuted}
                  value={menuQuery}
                  onChangeText={setMenuQuery}
                  autoCapitalize="sentences"
                  returnKeyType="done"
                  onFocus={focusMenuSearch}
                  onSubmitEditing={() => applyTextOperator('subject')}
                />
                <TouchableOpacity
                  style={styles.menuApplyBtn}
                  onPress={() => applyTextOperator('subject')}
                >
                  <Text style={styles.menuApplyText}>Apply</Text>
                </TouchableOpacity>
              </View>
              {getOperatorValue(search, 'subject') ? (
                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={() => applyFilter(setOperator(search, 'subject', null))}
                >
                  <Text style={styles.menuItemClear}>Clear subject filter</Text>
                </TouchableOpacity>
              ) : null}
            </>
          ) : null}

          {openMenu === 'attachment' ? (
            <ScrollView
              style={[styles.menuScroll, { maxHeight: menuScrollMaxHeight }]}
              keyboardShouldPersistTaps="always"
              nestedScrollEnabled
              keyboardDismissMode="none"
            >
              {activeAttachment ? (
                <TouchableOpacity style={styles.menuItem} onPress={clearAttachment}>
                  <Text style={styles.menuItemClear}>Clear attachment filter</Text>
                </TouchableOpacity>
              ) : null}
              {ATTACHMENT_FILTER_OPTIONS.map((opt) => {
                const selected = activeAttachment === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.menuItem, selected && styles.menuItemSelected]}
                    onPress={() => pickAttachment(opt.value)}
                  >
                    <Text
                      style={[styles.menuItemText, selected && styles.menuItemTextSelected]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          ) : null}

          {openMenu === 'date' ? (
            <ScrollView
              style={[styles.menuScroll, { maxHeight: menuScrollMaxHeight }]}
              keyboardShouldPersistTaps="always"
              nestedScrollEnabled
              keyboardDismissMode="none"
            >
              {DATE_FILTER_OPTIONS.map((opt) => {
                const selected = (activeDate ?? '') === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.label}
                    style={[styles.menuItem, selected && styles.menuItemSelected]}
                    onPress={() => pickDate(opt.value)}
                  >
                    <Text
                      style={[styles.menuItemText, selected && styles.menuItemTextSelected]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          ) : null}

          {openMenu === 'is' ? (
            <ScrollView
              style={[styles.menuScroll, { maxHeight: menuScrollMaxHeight }]}
              keyboardShouldPersistTaps="always"
              nestedScrollEnabled
              keyboardDismissMode="none"
            >
              {IS_FILTER_OPTIONS.map((opt) => {
                const selected = (activeIs ?? '') === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.label}
                    style={[styles.menuItem, selected && styles.menuItemSelected]}
                    onPress={() => pickIs(opt.value)}
                  >
                    <Text
                      style={[styles.menuItemText, selected && styles.menuItemTextSelected]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: Gmail.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Gmail.border,
    paddingBottom: 10,
    gap: 8,
  },
  chipsRow: {
    paddingHorizontal: 12,
    gap: 8,
    alignItems: 'center',
    paddingVertical: 4,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
    backgroundColor: Gmail.bg,
    borderWidth: 1,
    borderColor: '#DADCE0',
  },
  chipActive: {
    borderColor: Gmail.blue,
    backgroundColor: Gmail.blueLight,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '400',
    color: Gmail.text,
  },
  chipTextActive: {
    color: Gmail.blue,
    fontWeight: '500',
  },
  chevron: {
    fontSize: 10,
    color: Gmail.text,
    marginTop: 1,
    marginLeft: 1,
  },
  menuPanel: {
    marginHorizontal: 12,
    backgroundColor: Gmail.bg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#DADCE0',
    overflow: 'hidden',
    maxHeight: 340,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  menuScroll: {
    maxHeight: 280,
  },
  menuSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Gmail.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  menuSearchInput: {
    flex: 1,
    fontSize: 15,
    color: Gmail.text,
    paddingVertical: 6,
  },
  menuApplyBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  menuApplyText: {
    fontSize: 14,
    fontWeight: '600',
    color: Gmail.blue,
  },
  menuItem: {
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Gmail.divider,
  },
  menuItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  menuItemSelected: {
    backgroundColor: Gmail.blueLight,
  },
  menuItemText: {
    fontSize: 15,
    color: Gmail.text,
  },
  menuItemTextSelected: {
    color: Gmail.blue,
    fontWeight: '500',
  },
  menuItemSub: {
    fontSize: 13,
    color: Gmail.textSecondary,
    marginTop: 2,
  },
  menuItemClear: {
    fontSize: 15,
    color: Gmail.red,
  },
  menuContactText: {
    flex: 1,
    minWidth: 0,
  },
  menuEmpty: {
    padding: 16,
    fontSize: 14,
    color: Gmail.textMuted,
    textAlign: 'center',
  },
  menuSpinner: {
    padding: 20,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
