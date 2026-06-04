import React, { useState } from 'react';
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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CallsTheme } from '../../constants/callsTheme';
import { normalisePhone } from '../../lib/call-utils';

type Props = {
  visible: boolean;
  agentPhone: string;
  virtualNumber: string;
  agentPhoneReadOnly?: boolean;
  placing: boolean;
  onClose: () => void;
  onSaveAgentPhone: (phone: string) => void;
  onPlaceCall: (destination: string) => void;
};

export function CallsDialerSheet({
  visible,
  agentPhone,
  virtualNumber,
  agentPhoneReadOnly = false,
  placing,
  onClose,
  onSaveAgentPhone,
  onPlaceCall,
}: Props) {
  const [destination, setDestination] = useState('');
  const [editingFrom, setEditingFrom] = useState(false);
  const [fromDraft, setFromDraft] = useState(agentPhone);

  function close() {
    setDestination('');
    setEditingFrom(false);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable style={styles.backdrop} onPress={close} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>New call</Text>

          <View style={styles.field}>
            <Text style={styles.label}>Your number</Text>
            {editingFrom && !agentPhoneReadOnly ? (
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.input}
                  value={fromDraft}
                  onChangeText={setFromDraft}
                  placeholder="+91 80561 01540"
                  placeholderTextColor={CallsTheme.textMuted}
                  keyboardType="phone-pad"
                  autoFocus
                />
                <TouchableOpacity
                  style={styles.iconBtn}
                  onPress={() => {
                    onSaveAgentPhone(fromDraft);
                    setEditingFrom(false);
                  }}
                >
                  <Ionicons name="checkmark-circle" size={28} color={CallsTheme.green} />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.fromRow}
                onPress={() => {
                  if (agentPhoneReadOnly) {
                    onSaveAgentPhone(agentPhone);
                    return;
                  }
                  setFromDraft(agentPhone);
                  setEditingFrom(true);
                }}
                disabled={agentPhoneReadOnly}
              >
                <Text style={[styles.fromValue, !agentPhone && styles.fromPlaceholder]}>
                  {agentPhone || (agentPhoneReadOnly ? 'Not set by admin' : 'Tap to add your phone')}
                </Text>
                {!agentPhoneReadOnly ? (
                  <Ionicons name="pencil-outline" size={18} color={CallsTheme.textMuted} />
                ) : null}
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Call</Text>
            <TextInput
              style={styles.input}
              value={destination}
              onChangeText={setDestination}
              placeholder="Phone number"
              placeholderTextColor={CallsTheme.textMuted}
              keyboardType="phone-pad"
              autoFocus={!!agentPhone && !editingFrom}
            />
          </View>

          {virtualNumber ? (
            <Text style={styles.hint}>
              You’ll dial {virtualNumber} and Exotel connects the call.
            </Text>
          ) : (
            <Text style={styles.hintWarn}>Ask your admin to assign an Exotel number under Team.</Text>
          )}

          <TouchableOpacity
            style={[styles.callBtn, placing && { opacity: 0.6 }]}
            onPress={() => onPlaceCall(destination)}
            disabled={placing}
            activeOpacity={0.85}
          >
            {placing ? (
              <ActivityIndicator color={CallsTheme.fabIcon} />
            ) : (
              <>
                <Ionicons name="call" size={20} color={CallsTheme.fabIcon} />
                <Text style={styles.callBtnText}>Start call</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelBtn} onPress={close}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: CallsTheme.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 28,
    paddingTop: 8,
    gap: 14,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: CallsTheme.border,
    marginBottom: 4,
  },
  title: { fontSize: 20, fontWeight: '400', color: CallsTheme.text },
  field: { gap: 6 },
  label: { fontSize: 12, fontWeight: '600', color: CallsTheme.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: CallsTheme.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 17,
    color: CallsTheme.text,
    backgroundColor: CallsTheme.bg,
  },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: { padding: 4 },
  fromRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: CallsTheme.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: CallsTheme.bg,
  },
  fromValue: { fontSize: 16, color: CallsTheme.text },
  fromPlaceholder: { color: CallsTheme.textMuted },
  hint: { fontSize: 13, color: CallsTheme.textSecondary, lineHeight: 18 },
  hintWarn: { fontSize: 13, color: CallsTheme.red },
  callBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: CallsTheme.green,
    borderRadius: 28,
    paddingVertical: 14,
    marginTop: 4,
  },
  callBtnText: { fontSize: 16, fontWeight: '600', color: CallsTheme.fabIcon },
  cancelBtn: { alignItems: 'center', paddingVertical: 8 },
  cancelText: { fontSize: 15, color: CallsTheme.textSecondary, fontWeight: '500' },
});
