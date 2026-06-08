import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DriveTheme } from '../../constants/driveTheme';

type Props = {
  visible: boolean;
  onClose: () => void;
  onUploadFiles: () => void;
  onUploadFolder: () => void;
  onCreateFolder: (name: string) => void;
};

export function DriveCreateSheet({
  visible,
  onClose,
  onUploadFiles,
  onUploadFolder,
  onCreateFolder,
}: Props) {
  const [showFolderName, setShowFolderName] = useState(false);
  const [folderName, setFolderName] = useState('');

  function closeAll() {
    setShowFolderName(false);
    setFolderName('');
    onClose();
  }

  function submitFolder() {
    const name = folderName.trim();
    if (!name) return;
    setShowFolderName(false);
    setFolderName('');
    onClose();
    onCreateFolder(name);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={closeAll}>
      <Pressable style={styles.backdrop} onPress={closeAll}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.kav}
        >
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Create</Text>

            {showFolderName ? (
              <View style={styles.folderForm}>
                <Text style={styles.folderLabel}>Folder name</Text>
                <TextInput
                  style={styles.folderInput}
                  value={folderName}
                  onChangeText={setFolderName}
                  placeholder="Untitled folder"
                  placeholderTextColor={DriveTheme.textMuted}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={submitFolder}
                />
                <View style={styles.folderActions}>
                  <TouchableOpacity
                    style={styles.folderCancelBtn}
                    onPress={() => {
                      setShowFolderName(false);
                      setFolderName('');
                    }}
                  >
                    <Text style={styles.folderCancelText}>Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.folderCreateBtn, !folderName.trim() && styles.folderCreateDisabled]}
                    onPress={submitFolder}
                    disabled={!folderName.trim()}
                  >
                    <Text style={styles.folderCreateText}>Create</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <>
                <CreateOption
                  icon="document-outline"
                  label="Upload files"
                  subtitle="Choose files from your device"
                  onPress={() => {
                    onClose();
                    onUploadFiles();
                  }}
                />
                <CreateOption
                  icon="folder-outline"
                  label="Upload folder"
                  subtitle="Select multiple files at once"
                  onPress={() => {
                    onClose();
                    onUploadFolder();
                  }}
                />
                <CreateOption
                  icon="folder-open-outline"
                  label="New folder"
                  subtitle="Create a folder in this location"
                  onPress={() => setShowFolderName(true)}
                />
              </>
            )}

            <TouchableOpacity style={styles.cancelRow} onPress={closeAll}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

function CreateOption({
  icon,
  label,
  subtitle,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.optionRow} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.optionIcon}>
        <Ionicons name={icon} size={22} color={DriveTheme.blue} />
      </View>
      <View style={styles.optionBody}>
        <Text style={styles.optionLabel}>{label}</Text>
        <Text style={styles.optionSubtitle}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={DriveTheme.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  kav: { width: '100%' },
  sheet: {
    backgroundColor: DriveTheme.sheet,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 24,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: DriveTheme.border,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 4,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: DriveTheme.text,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  optionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: DriveTheme.blueLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionBody: { flex: 1, gap: 2 },
  optionLabel: { fontSize: 16, fontWeight: '500', color: DriveTheme.text },
  optionSubtitle: { fontSize: 13, color: DriveTheme.textSecondary },
  folderForm: { paddingHorizontal: 20, paddingBottom: 8, gap: 10 },
  folderLabel: { fontSize: 14, fontWeight: '500', color: DriveTheme.textSecondary },
  folderInput: {
    borderWidth: 1,
    borderColor: DriveTheme.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: DriveTheme.text,
    backgroundColor: DriveTheme.bg,
  },
  folderActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  folderCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: DriveTheme.bgMuted,
  },
  folderCancelText: { fontSize: 15, fontWeight: '600', color: DriveTheme.textSecondary },
  folderCreateBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: DriveTheme.blue,
  },
  folderCreateDisabled: { opacity: 0.5 },
  folderCreateText: { fontSize: 15, fontWeight: '600', color: '#fff' },
  cancelRow: {
    marginTop: 8,
    marginHorizontal: 16,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: DriveTheme.bgMuted,
    borderRadius: 12,
  },
  cancelText: { fontSize: 16, fontWeight: '600', color: DriveTheme.textSecondary },
});
