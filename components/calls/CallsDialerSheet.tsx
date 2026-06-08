import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Pressable,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CallsTheme } from '../../constants/callsTheme';
import { normalisePhone } from '../../lib/call-utils';

type Props = {
  visible: boolean;
  agentPhone: string;
  virtualNumber: string;
  agentPhoneReadOnly?: boolean;
  placing: boolean;
  /** Pre-fill the destination number (e.g. when calling from a contact). */
  initialDestination?: string;
  onClose: () => void;
  onSaveAgentPhone: (phone: string) => void;
  onPlaceCall: (destination: string) => void;
};

const DIALPAD_KEYS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['+', '0', '⌫'],
];

export function CallsDialerSheet({
  visible,
  agentPhone,
  virtualNumber,
  agentPhoneReadOnly = false,
  placing,
  initialDestination,
  onClose,
  onSaveAgentPhone,
  onPlaceCall,
}: Props) {
  const insets = useSafeAreaInsets();
  const [destination, setDestination] = useState('');
  const [editingFrom, setEditingFrom] = useState(false);
  const [fromDraft, setFromDraft] = useState(agentPhone);
  const destRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) {
      setDestination(initialDestination ?? '');
      setEditingFrom(false);
      setFromDraft(agentPhone);
    }
  }, [visible, agentPhone, initialDestination]);

  function close() {
    setDestination('');
    setEditingFrom(false);
    onClose();
  }

  function pressDialKey(key: string) {
    if (key === '⌫') {
      setDestination((prev) => prev.slice(0, -1));
    } else {
      setDestination((prev) => prev + key);
    }
  }

  const canCall = !!destination.trim() && !placing;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable style={styles.backdrop} onPress={close} />

        <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
          {/* Handle */}
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.headerRow}>
            <Text style={styles.title}>New Call</Text>
            <TouchableOpacity onPress={close} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={CallsTheme.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.scrollContent}
          >
            {/* Destination number display */}
            <View style={styles.numberDisplayRow}>
              <TextInput
                ref={destRef}
                style={styles.numberDisplay}
                value={destination}
                onChangeText={setDestination}
                placeholder="Enter number"
                placeholderTextColor={CallsTheme.textMuted}
                keyboardType="phone-pad"
                autoFocus={false}
                showSoftInputOnFocus={false}
                selection={{ start: destination.length, end: destination.length }}
              />
              {destination.length > 0 && (
                <TouchableOpacity onPress={() => setDestination('')} style={styles.clearBtn}>
                  <Ionicons name="close-circle" size={22} color={CallsTheme.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            {/* Dialpad */}
            <View style={styles.dialpad}>
              {DIALPAD_KEYS.map((row, ri) => (
                <View key={ri} style={styles.dialRow}>
                  {row.map((key) => (
                    <TouchableOpacity
                      key={key}
                      style={[styles.dialKey, key === '⌫' && styles.dialKeyBackspace]}
                      onPress={() => pressDialKey(key)}
                      activeOpacity={0.7}
                    >
                      {key === '⌫' ? (
                        <Ionicons name="backspace-outline" size={24} color={CallsTheme.text} />
                      ) : (
                        <Text style={styles.dialKeyText}>{key}</Text>
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              ))}
            </View>

            {/* From number */}
            <View style={styles.fromSection}>
              <Text style={styles.fromLabel}>Calling from</Text>
              {editingFrom && !agentPhoneReadOnly ? (
                <View style={styles.fromEditRow}>
                  <TextInput
                    style={styles.fromInput}
                    value={fromDraft}
                    onChangeText={setFromDraft}
                    placeholder="+91 80561 01540"
                    placeholderTextColor={CallsTheme.textMuted}
                    keyboardType="phone-pad"
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={() => {
                      onSaveAgentPhone(fromDraft);
                      setEditingFrom(false);
                    }}
                  />
                  <TouchableOpacity
                    style={styles.fromSaveBtn}
                    onPress={() => {
                      onSaveAgentPhone(fromDraft);
                      setEditingFrom(false);
                    }}
                  >
                    <Ionicons name="checkmark" size={20} color={CallsTheme.fabIcon} />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.fromRow}
                  onPress={() => {
                    if (agentPhoneReadOnly) return;
                    setFromDraft(agentPhone);
                    setEditingFrom(true);
                  }}
                  disabled={agentPhoneReadOnly}
                  activeOpacity={agentPhoneReadOnly ? 1 : 0.7}
                >
                  <Ionicons
                    name="phone-portrait-outline"
                    size={18}
                    color={agentPhone ? CallsTheme.blue : CallsTheme.textMuted}
                  />
                  <Text style={[styles.fromValue, !agentPhone && styles.fromPlaceholder]}>
                    {agentPhone
                      ? agentPhone
                      : agentPhoneReadOnly
                      ? 'Not set — ask your admin'
                      : 'Tap to add your number'}
                  </Text>
                  {!agentPhoneReadOnly && (
                    <Ionicons name="pencil-outline" size={16} color={CallsTheme.textMuted} />
                  )}
                </TouchableOpacity>
              )}
            </View>

            {virtualNumber ? (
              <Text style={styles.hint}>
                <Ionicons name="information-circle-outline" size={13} color={CallsTheme.textSecondary} />{' '}
                You'll dial <Text style={styles.hintBold}>{virtualNumber}</Text> — Exotel connects the call.
              </Text>
            ) : (
              <Text style={styles.hintWarn}>
                <Ionicons name="warning-outline" size={13} color={CallsTheme.red} /> Ask your admin to assign an
                Exotel number under Team.
              </Text>
            )}

            {/* Call button */}
            <TouchableOpacity
              style={[styles.callBtn, !canCall && styles.callBtnDisabled]}
              onPress={() => onPlaceCall(destination)}
              disabled={!canCall}
              activeOpacity={0.85}
            >
              {placing ? (
                <ActivityIndicator color={CallsTheme.fabIcon} />
              ) : (
                <>
                  <Ionicons name="call" size={22} color={CallsTheme.fabIcon} />
                  <Text style={styles.callBtnText}>Start Call</Text>
                </>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const KEY_SIZE = 72;

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: CallsTheme.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    maxHeight: '92%',
  },
  scrollContent: { paddingBottom: 8 },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: CallsTheme.border,
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: { fontSize: 20, fontWeight: '600', color: CallsTheme.text },
  closeBtn: { padding: 4 },

  // Number display
  numberDisplayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CallsTheme.bg,
    borderWidth: 1.5,
    borderColor: CallsTheme.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 20,
    minHeight: 58,
  },
  numberDisplay: {
    flex: 1,
    fontSize: 28,
    fontWeight: '300',
    color: CallsTheme.text,
    letterSpacing: 2,
  },
  clearBtn: { padding: 4 },

  // Dialpad
  dialpad: { gap: 8, marginBottom: 20 },
  dialRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  dialKey: {
    flex: 1,
    height: KEY_SIZE,
    borderRadius: 36,
    backgroundColor: CallsTheme.grayLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialKeyBackspace: {
    backgroundColor: 'transparent',
  },
  dialKeyText: {
    fontSize: 26,
    fontWeight: '300',
    color: CallsTheme.text,
  },

  // From section
  fromSection: { marginBottom: 12, gap: 6 },
  fromLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: CallsTheme.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  fromRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: CallsTheme.bg,
    borderWidth: 1,
    borderColor: CallsTheme.border,
    borderRadius: 10,
  },
  fromValue: { flex: 1, fontSize: 15, color: CallsTheme.text, fontWeight: '500' },
  fromPlaceholder: { color: CallsTheme.textMuted, fontWeight: '400' },
  fromEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  fromInput: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: CallsTheme.blue,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: CallsTheme.text,
    backgroundColor: CallsTheme.bg,
  },
  fromSaveBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: CallsTheme.green,
    alignItems: 'center',
    justifyContent: 'center',
  },

  hint: {
    fontSize: 13,
    color: CallsTheme.textSecondary,
    lineHeight: 18,
    marginBottom: 16,
  },
  hintBold: { fontWeight: '600' },
  hintWarn: {
    fontSize: 13,
    color: CallsTheme.red,
    lineHeight: 18,
    marginBottom: 16,
  },

  // Call button
  callBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: CallsTheme.green,
    borderRadius: 32,
    paddingVertical: 16,
    marginTop: 4,
    elevation: 2,
    shadowColor: CallsTheme.green,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  callBtnDisabled: {
    backgroundColor: CallsTheme.border,
    elevation: 0,
    shadowOpacity: 0,
  },
  callBtnText: { fontSize: 17, fontWeight: '700', color: CallsTheme.fabIcon },
});
