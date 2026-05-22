import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator, Alert, Modal, TextInput,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import ScreenHeader from '../../../components/ScreenHeader';
import EmptyState from '../../../components/EmptyState';
import { useDrawer } from '../_layout';
import { formsApi, type FormListRow } from '../../../lib/api';
import { Colors } from '../../../constants/colors';

export default function FormsScreen() {
  const router = useRouter();
  const { openDrawer } = useDrawer();
  const [forms, setForms] = useState<FormListRow[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async (opts: { append: boolean; pageToken?: string }) => {
    if (!opts.append) {
      setError(null);
    }
    try {
      const data = await formsApi.list({ pageSize: 30, pageToken: opts.pageToken });
      setForms((prev) => (opts.append ? [...prev, ...(data.forms ?? [])] : data.forms ?? []));
      setNextPageToken(data.nextPageToken);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load forms');
      if (!opts.append) setForms([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    load({ append: false });
  }, [load]);

  async function handleCreate() {
    const t = newTitle.trim();
    if (!t || creating) return;
    setCreating(true);
    try {
      const res = await formsApi.create(t);
      if (!res?.formId) throw new Error('No form id returned');
      setShowCreate(false);
      setNewTitle('');
      router.push(`/(workspace)/forms/${encodeURIComponent(res.formId)}/edit` as any);
    } catch (e: any) {
      Alert.alert('Could not create form', e?.message ?? 'Something went wrong');
    } finally {
      setCreating(false);
    }
  }

  function loadMore() {
    if (!nextPageToken || loadingMore) return;
    setLoadingMore(true);
    load({ append: true, pageToken: nextPageToken });
  }

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Forms"
        onMenuPress={openDrawer}
        rightAction={{ icon: 'add-circle-outline', onPress: () => { setNewTitle(''); setShowCreate(true); } }}
      />

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="warning-outline" size={32} color={Colors.error} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); load({ append: false }); }}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={forms}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <FormRow
              form={item}
              onPress={() => router.push(`/(workspace)/forms/${encodeURIComponent(item.id)}/edit` as any)}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load({ append: false }); }}
              tintColor={Colors.primary}
            />
          }
          ListEmptyComponent={
            <EmptyState icon="document-text-outline" title="No forms yet" subtitle="Tap the + above to create one" />
          }
          ListFooterComponent={
            nextPageToken ? (
              <TouchableOpacity style={styles.loadMoreBtn} onPress={loadMore} disabled={loadingMore}>
                {loadingMore
                  ? <ActivityIndicator size="small" color={Colors.primary} />
                  : <Text style={styles.loadMoreText}>Load more</Text>}
              </TouchableOpacity>
            ) : null
          }
          contentContainerStyle={forms.length === 0 ? { flex: 1 } : { padding: 12, gap: 8, paddingBottom: 24 }}
        />
      )}

      <Modal visible={showCreate} transparent animationType="fade" onRequestClose={() => setShowCreate(false)}>
        <KeyboardAvoidingView
          style={styles.backdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setShowCreate(false)} />
          <View style={styles.card}>
            <Text style={styles.cardTitle}>New form</Text>
            <Text style={styles.hint}>Creates a Google Form in your connected admin account.</Text>
            <TextInput
              style={styles.input}
              value={newTitle}
              onChangeText={setNewTitle}
              placeholder="Form title"
              placeholderTextColor={Colors.textMuted}
              autoFocus
            />
            <View style={styles.actions}>
              <TouchableOpacity style={[styles.btn, styles.btnCancel]} onPress={() => setShowCreate(false)}>
                <Text style={styles.btnCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnSave, (!newTitle.trim() || creating) && { opacity: 0.6 }]}
                onPress={handleCreate}
                disabled={!newTitle.trim() || creating}
              >
                {creating
                  ? <ActivityIndicator color={Colors.surface} size="small" />
                  : <Text style={styles.btnSaveText}>Create &amp; edit</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function FormRow({ form, onPress }: { form: FormListRow; onPress: () => void }) {
  const title = form.formTitle?.trim() || form.name?.trim() || 'Untitled';
  const modified = form.modifiedTime ? format(new Date(form.modifiedTime), 'MMM d, yyyy h:mm a') : '';
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.rowIcon}>
        <Ionicons name="document-text" size={20} color={Colors.primary} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
        {modified ? <Text style={styles.rowMeta}>Modified {modified}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { fontSize: 14, color: Colors.error, textAlign: 'center', marginTop: 8 },
  retryBtn: { marginTop: 12, paddingHorizontal: 20, paddingVertical: 8, backgroundColor: Colors.primary, borderRadius: 8 },
  retryText: { color: Colors.surface, fontWeight: '600', fontSize: 14 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    backgroundColor: Colors.surface, borderRadius: 12,
  },
  rowIcon: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: Colors.primaryLight ?? '#E0E7FF',
    alignItems: 'center', justifyContent: 'center',
  },
  rowBody: { flex: 1, gap: 3 },
  rowTitle: { fontSize: 14, fontWeight: '600', color: Colors.text },
  rowMeta: { fontSize: 11, color: Colors.textMuted },

  loadMoreBtn: {
    margin: 12, padding: 12, alignItems: 'center',
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
  },
  loadMoreText: { fontSize: 13, fontWeight: '600', color: Colors.primary },

  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center', padding: 20,
  },
  card: {
    backgroundColor: Colors.surface, borderRadius: 20,
    padding: 22, gap: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2, shadowRadius: 16, elevation: 10,
  },
  cardTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  hint: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },
  input: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: Colors.text, backgroundColor: Colors.background,
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  btn: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 10, minHeight: 44,
  },
  btnCancel: { backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border },
  btnCancelText: { color: Colors.textSecondary, fontWeight: '600', fontSize: 14 },
  btnSave: { backgroundColor: Colors.primary },
  btnSaveText: { color: Colors.surface, fontWeight: '700', fontSize: 14 },
});
