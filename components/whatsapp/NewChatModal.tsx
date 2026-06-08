import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Pressable,
  Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../constants/colors';
import { isValidE164, normalizePhone } from '../../lib/phone';
import { filterSavedContacts } from '../../lib/whatsapp-contacts';
import { formatWhatsAppPhone, lookupContactName, peerInitials } from '../../lib/whatsapp-utils';
import { useKeyboardHeight } from '../../hooks/useKeyboardHeight';

type Props = {
  visible: boolean;
  onClose: () => void;
  onStart: (peer: string) => void;
  contacts: Record<string, string>;
  onSaveContact?: (peer: string, name: string) => Promise<void>;
};

export function NewChatModal({
  visible,
  onClose,
  onStart,
  contacts,
  onSaveContact,
}: Props) {
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const scrollRef = useRef<ScrollView>(null);
  const nameInputRef = useRef<TextInput>(null);

  const [phone, setPhone] = useState('');
  const [saveName, setSaveName] = useState('');
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const suggestions = useMemo(() => {
    if (showSaveForm) return [];
    return filterSavedContacts(contacts, phone);
  }, [contacts, phone, showSaveForm]);

  const normalized = normalizePhone(phone.trim());
  const validPhone = phone.trim().length > 0 && isValidE164(normalized);

  const sheetBottomPad = Math.max(insets.bottom, 16) + keyboardHeight;

  useEffect(() => {
    if (!showSaveForm) return;
    const t = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
      nameInputRef.current?.focus();
    }, 80);
    return () => clearTimeout(t);
  }, [showSaveForm]);

  function reset() {
    setPhone('');
    setSaveName('');
    setShowSaveForm(false);
    setError(null);
  }

  function close() {
    Keyboard.dismiss();
    reset();
    onClose();
  }

  function submit(peer?: string) {
    const target = peer ?? normalized;
    if (!isValidE164(target)) {
      setError('Use +918489431508 or 10-digit mobile');
      return;
    }
    setError(null);
    reset();
    onStart(target);
    onClose();
  }

  async function saveAndStart() {
    if (!validPhone || !saveName.trim() || !onSaveContact) return;
    setSaving(true);
    try {
      await onSaveContact(normalized, saveName.trim());
      submit(normalized);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save contact');
    } finally {
      setSaving(false);
    }
  }

  function openSaveForm() {
    setShowSaveForm(true);
    setSaveName(lookupContactName(normalized, contacts) ?? '');
    Keyboard.dismiss();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        <Pressable
          style={[styles.sheet, { paddingBottom: sheetBottomPad }]}
          onPress={(e) => e.stopPropagation()}
        >
          <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <View style={styles.handle} />
            <Text style={styles.title}>New chat</Text>

            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={(t) => {
                setPhone(t);
                setError(null);
                if (showSaveForm) setShowSaveForm(false);
              }}
              placeholder="Name, number, or +91…"
              placeholderTextColor={Colors.textMuted}
              keyboardType="phone-pad"
              returnKeyType="done"
            />

            {validPhone && onSaveContact && !showSaveForm ? (
              <TouchableOpacity style={styles.saveLink} onPress={openSaveForm}>
                <Text style={styles.saveLinkText}>
                  {lookupContactName(normalized, contacts)
                    ? 'Update saved contact'
                    : 'Save number to contacts'}
                </Text>
              </TouchableOpacity>
            ) : null}

            {showSaveForm && validPhone ? (
              <View style={styles.saveForm}>
                <Text style={styles.saveFormLabel}>Contact name</Text>
                <Text style={styles.saveFormPhone}>{formatWhatsAppPhone(normalized)}</Text>
                <TextInput
                  ref={nameInputRef}
                  style={styles.input}
                  value={saveName}
                  onChangeText={setSaveName}
                  placeholder="Enter name"
                  placeholderTextColor={Colors.textMuted}
                  autoCapitalize="words"
                  returnKeyType="done"
                  onFocus={() => {
                    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
                  }}
                />
                <TouchableOpacity
                  style={[styles.saveBtn, (!saveName.trim() || saving) && styles.disabled]}
                  onPress={() => void saveAndStart()}
                  disabled={!saveName.trim() || saving}
                >
                  <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save & open chat'}</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}

            {suggestions.length > 0 ? (
              <>
                <Text style={styles.sectionLabel}>Saved contacts</Text>
                {suggestions.map((item) => (
                  <TouchableOpacity
                    key={item.peer_e164}
                    style={styles.suggestRow}
                    onPress={() => submit(item.peer_e164)}
                  >
                    <View style={styles.suggestAvatar}>
                      <Text style={styles.suggestAvatarText}>
                        {peerInitials(item.peer_e164, item.name)}
                      </Text>
                    </View>
                    <View style={styles.suggestBody}>
                      <Text style={styles.suggestName}>{item.name}</Text>
                      <Text style={styles.suggestPhone}>{formatWhatsAppPhone(item.peer_e164)}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </>
            ) : null}
          </ScrollView>

          <View style={[styles.actions, keyboardHeight > 0 && styles.actionsKeyboard]}>
            <TouchableOpacity style={styles.cancelBtn} onPress={close}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.startBtn, !validPhone && styles.disabled]}
              onPress={() => submit()}
              disabled={!validPhone}
            >
              <Text style={styles.startText}>Chat</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    maxHeight: '92%',
  },
  scroll: { flexGrow: 0, flexShrink: 1 },
  scrollContent: { paddingBottom: 8 },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 12,
  },
  title: { fontSize: 18, fontWeight: '700', color: Colors.text, marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    color: Colors.text,
    backgroundColor: Colors.background,
    marginBottom: 8,
  },
  saveLink: { marginBottom: 8 },
  saveLinkText: { fontSize: 14, fontWeight: '600', color: '#075E54' },
  saveForm: {
    gap: 8,
    marginBottom: 12,
    padding: 12,
    backgroundColor: '#E7F8EF',
    borderRadius: 12,
  },
  saveFormLabel: { fontSize: 13, fontWeight: '600', color: '#075E54' },
  saveFormPhone: { fontSize: 14, color: Colors.textSecondary, marginBottom: 4 },
  saveBtn: {
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#075E54',
    alignItems: 'center',
    marginTop: 4,
  },
  saveBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMuted,
    marginTop: 4,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  suggestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderLight,
  },
  suggestAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#075E54',
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestAvatarText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  suggestBody: { flex: 1 },
  suggestName: { fontSize: 15, fontWeight: '600', color: Colors.text },
  suggestPhone: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  error: { fontSize: 12, color: Colors.error, marginBottom: 8 },
  actions: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 8,
    paddingBottom: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.borderLight,
  },
  actionsKeyboard: {
    backgroundColor: Colors.surface,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  cancelText: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },
  startBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#25D366',
    alignItems: 'center',
  },
  startText: { fontSize: 15, fontWeight: '600', color: '#fff' },
  disabled: { opacity: 0.45 },
});
