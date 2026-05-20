import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator, Alert, Modal, TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatDistanceToNow } from 'date-fns';
import ScreenHeader from '../../../components/ScreenHeader';
import EmptyState from '../../../components/EmptyState';
import { useDrawer } from '../_layout';
import { formsApi } from '../../../lib/api';
import { Colors } from '../../../constants/colors';

export default function FormsScreen() {
  const { openDrawer } = useDrawer();
  const [forms, setForms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [saving, setSaving] = useState(false);

  const loadForms = useCallback(async () => {
    try {
      const data = await formsApi.list();
      setForms(data.forms ?? []);
    } catch {
      setForms([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadForms(); }, [loadForms]);

  async function createForm() {
    if (!newTitle.trim()) return;
    setSaving(true);
    try {
      await formsApi.create({ title: newTitle, description: newDesc });
      setShowCreate(false);
      setNewTitle('');
      setNewDesc('');
      await loadForms();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Forms"
        onMenuPress={openDrawer}
        rightAction={{ icon: 'add-circle-outline', onPress: () => setShowCreate(true) }}
      />
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>
      ) : (
        <FlatList
          data={forms}
          keyExtractor={(item) => item.formId ?? item.id}
          renderItem={({ item }) => <FormRow form={item} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadForms(); }} tintColor={Colors.primary} />}
          ListEmptyComponent={<EmptyState icon="document-text-outline" title="No forms yet" subtitle="Create a Google Form to get started" />}
          contentContainerStyle={forms.length === 0 ? { flex: 1 } : { padding: 12, gap: 8 }}
        />
      )}

      <Modal visible={showCreate} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Create Form</Text>
            <TextInput
              style={styles.input}
              value={newTitle}
              onChangeText={setNewTitle}
              placeholder="Form title"
              placeholderTextColor={Colors.textMuted}
            />
            <TextInput
              style={[styles.input, styles.inputMulti]}
              value={newDesc}
              onChangeText={setNewDesc}
              placeholder="Description (optional)"
              placeholderTextColor={Colors.textMuted}
              multiline
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowCreate(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={createForm} disabled={saving}>
                {saving ? <ActivityIndicator size="small" color={Colors.surface} /> : <Text style={styles.saveText}>Create</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function FormRow({ form }: { form: any }) {
  return (
    <View style={styles.formCard}>
      <View style={styles.formCardHeader}>
        <View style={styles.formIcon}>
          <Ionicons name="document-text" size={20} color={Colors.primary} />
        </View>
        <View style={styles.formInfo}>
          <Text style={styles.formTitle} numberOfLines={1}>{form.info?.title ?? form.title ?? 'Untitled Form'}</Text>
          {form.info?.description && (
            <Text style={styles.formDesc} numberOfLines={2}>{form.info.description}</Text>
          )}
        </View>
      </View>
      <View style={styles.formMeta}>
        <View style={styles.metaItem}>
          <Ionicons name="help-circle-outline" size={14} color={Colors.textMuted} />
          <Text style={styles.metaText}>{(form.items ?? []).length} questions</Text>
        </View>
        {form.responderUri && (
          <TouchableOpacity style={styles.linkBtn}>
            <Ionicons name="link-outline" size={14} color={Colors.primary} />
            <Text style={styles.linkText}>Open Form</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  formCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    gap: 10,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 4,
    elevation: 2,
  },
  formCardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  formIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formInfo: { flex: 1, gap: 4 },
  formTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  formDesc: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  formMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 12, color: Colors.textMuted },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  linkText: { fontSize: 12, color: Colors.primary, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: Colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, gap: 14 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  input: { borderWidth: 1, borderColor: Colors.border, borderRadius: 10, padding: 12, fontSize: 14, color: Colors.text },
  inputMulti: { minHeight: 80, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', gap: 12 },
  cancelBtn: { flex: 1, padding: 13, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' },
  cancelText: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },
  saveBtn: { flex: 1, padding: 13, borderRadius: 10, backgroundColor: Colors.primary, alignItems: 'center' },
  saveText: { fontSize: 15, fontWeight: '700', color: Colors.surface },
});
