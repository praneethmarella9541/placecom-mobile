import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { format } from 'date-fns';
import EmptyState from '../../../components/EmptyState';
import { useDrawer } from '../_layout';
import { formsApi, type FormListRow } from '../../../lib/api';
import { FormsTheme } from '../../../constants/formsTheme';
import { cacheGet, cacheSet, cacheIsStale } from '../../../lib/cache';

const FORMS_CACHE_KEY = 'forms:list';

export default function FormsScreen() {
  const router = useRouter();
  const { openDrawer } = useDrawer();
  const insets = useSafeAreaInsets();
  const searchRef = useRef<TextInput>(null);
  const [forms, setForms] = useState<FormListRow[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(
    async (opts: { append: boolean; pageToken?: string }) => {
      const cacheKey = debouncedSearch ? `${FORMS_CACHE_KEY}:${debouncedSearch}` : FORMS_CACHE_KEY;

      if (!opts.append) {
        setError(null);
        const cached = cacheGet<FormListRow[]>(cacheKey);
        if (cached) {
          setForms(cached);
          setLoading(false);
          if (!cacheIsStale(cacheKey)) {
            setRefreshing(false);
            return;
          }
        }
      }

      try {
        const data = await formsApi.list({
          pageSize: 20,
          pageToken: opts.pageToken,
          search: debouncedSearch || undefined,
        });
        const batch = data.forms ?? [];
        const updated = opts.append ? [...(cacheGet<FormListRow[]>(cacheKey) ?? []), ...batch] : batch;
        if (!opts.append) cacheSet(cacheKey, updated);
        setForms((prev) => (opts.append ? [...prev, ...batch] : batch));
        setNextPageToken(data.nextPageToken);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Failed to load forms');
        if (!opts.append) setForms([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    },
    [debouncedSearch]
  );

  useEffect(() => {
    setLoading(true);
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
    } catch (e: unknown) {
      Alert.alert('Could not create form', e instanceof Error ? e.message : 'Something went wrong');
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
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <TouchableOpacity onPress={openDrawer} style={styles.headerBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="menu" size={24} color={FormsTheme.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Forms</Text>
        <View style={styles.headerBtn} />
      </View>

      <Pressable style={styles.searchRow} onPress={() => searchRef.current?.focus()}>
        <Ionicons name="search" size={20} color={FormsTheme.textSecondary} />
        <TextInput
          ref={searchRef}
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search forms"
          placeholderTextColor={FormsTheme.textMuted}
          returnKeyType="search"
        />
        {search.length > 0 ? (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={20} color={FormsTheme.textMuted} />
          </TouchableOpacity>
        ) : null}
      </Pressable>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={FormsTheme.purple} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="warning-outline" size={32} color="#D93025" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => {
              setLoading(true);
              load({ append: false });
            }}
          >
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={forms}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <FormCard
              form={item}
              onPress={() => router.push(`/(workspace)/forms/${encodeURIComponent(item.id)}/edit` as any)}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load({ append: false });
              }}
              tintColor={FormsTheme.purple}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="document-text-outline"
              title={debouncedSearch ? 'No forms found' : 'No forms yet'}
              subtitle={debouncedSearch ? 'Try another search' : 'Tap + to create a blank form'}
            />
          }
          ListFooterComponent={
            nextPageToken ? (
              <TouchableOpacity style={styles.loadMoreBtn} onPress={loadMore} disabled={loadingMore}>
                {loadingMore ? (
                  <ActivityIndicator size="small" color={FormsTheme.purple} />
                ) : (
                  <Text style={styles.loadMoreText}>Load more</Text>
                )}
              </TouchableOpacity>
            ) : null
          }
          contentContainerStyle={forms.length === 0 ? { flex: 1 } : styles.listContent}
        />
      )}

      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 20 }]}
        onPress={() => {
          setNewTitle('');
          setShowCreate(true);
        }}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={28} color={FormsTheme.fabIcon} />
      </TouchableOpacity>

      <Modal visible={showCreate} transparent animationType="fade" onRequestClose={() => setShowCreate(false)}>
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowCreate(false)} />
          <View style={styles.modalCard}>
            <View style={styles.modalBand} />
            <Text style={styles.modalTitle}>Blank form</Text>
            <Text style={styles.modalHint}>Creates a Google Form in your connected account.</Text>
            <TextInput
              style={styles.modalInput}
              value={newTitle}
              onChangeText={setNewTitle}
              placeholder="Untitled form"
              placeholderTextColor={FormsTheme.textMuted}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setShowCreate(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalCreate, (!newTitle.trim() || creating) && { opacity: 0.6 }]}
                onPress={handleCreate}
                disabled={!newTitle.trim() || creating}
              >
                {creating ? (
                  <ActivityIndicator color={FormsTheme.fabIcon} size="small" />
                ) : (
                  <Text style={styles.modalCreateText}>Create</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function FormCard({ form, onPress }: { form: FormListRow; onPress: () => void }) {
  const title = form.formTitle?.trim() || form.name?.trim() || 'Untitled form';
  const modified = form.modifiedTime ? format(new Date(form.modifiedTime), 'MMM d, yyyy') : '';
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.cardIcon}>
        <Ionicons name="document-text" size={22} color={FormsTheme.purple} />
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {title}
        </Text>
        {modified ? <Text style={styles.cardMeta}>Opened {modified}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={20} color={FormsTheme.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: FormsTheme.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 8,
    backgroundColor: FormsTheme.surface,
    borderBottomWidth: 1,
    borderBottomColor: FormsTheme.border,
  },
  headerBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 22, fontWeight: '400', color: FormsTheme.text, textAlign: 'center' },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginVertical: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: FormsTheme.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: FormsTheme.border,
  },
  searchInput: { flex: 1, fontSize: 16, color: FormsTheme.text, padding: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { fontSize: 14, color: '#D93025', textAlign: 'center', marginTop: 8 },
  retryBtn: {
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: FormsTheme.purple,
    borderRadius: 20,
  },
  retryText: { color: FormsTheme.fabIcon, fontWeight: '600', fontSize: 14 },
  listContent: { paddingHorizontal: 16, paddingBottom: 100, gap: 10 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: FormsTheme.surface,
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: FormsTheme.border,
  },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 4,
    backgroundColor: FormsTheme.purpleLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1, gap: 4, minWidth: 0 },
  cardTitle: { fontSize: 15, fontWeight: '500', color: FormsTheme.text },
  cardMeta: { fontSize: 12, color: FormsTheme.textSecondary },
  loadMoreBtn: {
    marginTop: 8,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: FormsTheme.border,
    borderRadius: 8,
    backgroundColor: FormsTheme.surface,
  },
  loadMoreText: { fontSize: 13, fontWeight: '600', color: FormsTheme.purple },
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: FormsTheme.fab,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: FormsTheme.surface,
    borderRadius: 12,
    overflow: 'hidden',
    padding: 20,
    gap: 10,
  },
  modalBand: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 10,
    backgroundColor: FormsTheme.headerBand,
  },
  modalTitle: { fontSize: 20, fontWeight: '400', color: FormsTheme.text, marginTop: 8 },
  modalHint: { fontSize: 13, color: FormsTheme.textSecondary, lineHeight: 18 },
  modalInput: {
    borderWidth: 1,
    borderColor: FormsTheme.border,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: FormsTheme.text,
    backgroundColor: FormsTheme.bg,
    marginTop: 4,
  },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  modalCancel: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 4,
  },
  modalCancelText: { fontSize: 14, fontWeight: '600', color: FormsTheme.purple },
  modalCreate: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 4,
    backgroundColor: FormsTheme.purple,
  },
  modalCreateText: { fontSize: 14, fontWeight: '600', color: FormsTheme.fabIcon },
});
