import React, { useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../constants/colors';
import { isValidE164, normalizePhone } from '../../lib/phone';
import { filterSavedContacts } from '../../lib/whatsapp-contacts';
import { formatWhatsAppPhone, peerInitials } from '../../lib/whatsapp-utils';

type Props = {
  visible: boolean;
  onClose: () => void;
  onForward: (peer: string) => void;
  contacts: Record<string, string>;
};

export function ForwardChatModal({ visible, onClose, onForward, contacts }: Props) {
  const insets = useSafeAreaInsets();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);

  const suggestions = useMemo(() => filterSavedContacts(contacts, phone), [contacts, phone]);
  const normalized = normalizePhone(phone.trim());
  const validPhone = phone.trim().length > 0 && isValidE164(normalized);

  function close() {
    setPhone('');
    setError(null);
    onClose();
  }

  function pick(peer: string) {
    onForward(peer);
    close();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.handle} />
          <Text style={styles.title}>Forward to</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={(t) => {
              setPhone(t);
              setError(null);
            }}
            placeholder="Name or number"
            placeholderTextColor={Colors.textMuted}
            keyboardType="phone-pad"
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {suggestions.map((item) => (
              <TouchableOpacity
                key={item.peer_e164}
                style={styles.row}
                onPress={() => pick(item.peer_e164)}
              >
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{peerInitials(item.peer_e164, item.name)}</Text>
                </View>
                <View style={styles.rowBody}>
                  <Text style={styles.name}>{item.name}</Text>
                  <Text style={styles.sub}>{formatWhatsAppPhone(item.peer_e164)}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity
            style={[styles.forwardBtn, !validPhone && styles.disabled]}
            disabled={!validPhone}
            onPress={() => pick(normalized)}
          >
            <Text style={styles.forwardText}>Forward</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    maxHeight: '80%',
  },
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
    marginBottom: 8,
  },
  error: { fontSize: 12, color: Colors.error, marginBottom: 8 },
  list: { maxHeight: 280 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderLight,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#075E54',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontWeight: '700' },
  rowBody: { flex: 1 },
  name: { fontSize: 15, fontWeight: '600', color: Colors.text },
  sub: { fontSize: 13, color: Colors.textSecondary },
  forwardBtn: {
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#25D366',
    alignItems: 'center',
  },
  forwardText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  disabled: { opacity: 0.45 },
});
