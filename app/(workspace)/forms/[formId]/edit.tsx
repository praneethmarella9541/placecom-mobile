import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Switch, Modal, Pressable, Share,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../../../constants/colors';
import { formsApi } from '../../../../lib/api';
import {
  defaultChoiceBlock,
  defaultQuestionBlock,
  emptyEditorState,
  googleFormToEditorState,
  newSectionBlock,
  newTextBlock,
  type EditorBlock,
  type EditorBlockKind,
  type EditorState,
} from '../../../../lib/google-forms-editor-model';

const EMAIL_OPTIONS: { value: EditorState['emailCollection']; label: string }[] = [
  { value: 'DO_NOT_COLLECT', label: 'Do not collect email' },
  { value: 'RESPONDER_INPUT', label: 'Ask for email on form' },
  { value: 'VERIFIED', label: 'Verified email (Workspace)' },
  { value: 'EMAIL_COLLECTION_TYPE_UNSPECIFIED', label: 'Google default' },
];

type AddOption = { label: string; icon: keyof typeof Ionicons.glyphMap; build: () => EditorBlock };

const ADD_OPTIONS: AddOption[] = [
  { label: 'Short answer',  icon: 'create-outline',           build: () => defaultQuestionBlock('short_text') },
  { label: 'Paragraph',     icon: 'reader-outline',           build: () => defaultQuestionBlock('paragraph') },
  { label: 'Multiple choice', icon: 'radio-button-on-outline', build: () => defaultChoiceBlock('multiple_choice') },
  { label: 'Checkboxes',    icon: 'checkbox-outline',         build: () => defaultChoiceBlock('checkboxes') },
  { label: 'Dropdown',      icon: 'chevron-down-circle-outline', build: () => defaultChoiceBlock('dropdown') },
  { label: 'Linear scale',  icon: 'options-outline',          build: () => defaultQuestionBlock('linear_scale') },
  { label: 'Date',          icon: 'calendar-outline',         build: () => defaultQuestionBlock('date') },
  { label: 'Time',          icon: 'time-outline',             build: () => defaultQuestionBlock('time') },
  { label: 'Section break', icon: 'remove-outline',           build: () => newSectionBlock() },
  { label: 'Title & description', icon: 'text-outline',       build: () => newTextBlock() },
];

function blockLabel(kind: EditorBlockKind): string {
  switch (kind) {
    case 'short_text':      return 'Short answer';
    case 'paragraph':       return 'Paragraph';
    case 'multiple_choice': return 'Multiple choice';
    case 'checkboxes':      return 'Checkboxes';
    case 'dropdown':        return 'Dropdown';
    case 'linear_scale':    return 'Linear scale';
    case 'date':            return 'Date';
    case 'time':            return 'Time';
    case 'section':         return 'Section';
    case 'text_block':      return 'Title & description';
    case 'unsupported':     return 'Unsupported';
    default:                return 'Question';
  }
}

export default function FormEditScreen() {
  const { formId: rawId } = useLocalSearchParams<{ formId: string }>();
  const formId = typeof rawId === 'string' ? rawId : '';
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>(() => emptyEditorState());
  const [responderUri, setResponderUri] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    if (!formId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await formsApi.get(formId);
      setEditor(googleFormToEditorState(data));
      setResponderUri(typeof data.responderUri === 'string' ? (data.responderUri as string) : null);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load form');
    } finally {
      setLoading(false);
    }
  }, [formId]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await formsApi.save(formId, editor);
      if (!res?.ok) throw new Error(res?.message || res?.error || 'Save failed');
      if (res.editorState) {
        setEditor(res.editorState as EditorState);
      } else if (res.form) {
        setEditor(googleFormToEditorState(res.form));
      }
      if (res.form && typeof res.form.responderUri === 'string') {
        setResponderUri(res.form.responderUri as string);
      }
      Alert.alert('Saved', res.noChanges ? 'No changes to save.' : 'Form saved to Google.');
    } catch (e: any) {
      const msg = e?.message ?? 'Save failed';
      setError(msg);
      Alert.alert('Save failed', msg);
    } finally {
      setSaving(false);
    }
  }

  function updateBlock(i: number, patch: Partial<EditorBlock>) {
    setEditor((prev) => {
      const blocks = [...prev.blocks];
      const cur = blocks[i];
      if (!cur) return prev;
      blocks[i] = { ...cur, ...patch } as EditorBlock;
      return { ...prev, blocks };
    });
  }

  function removeBlock(i: number) {
    setEditor((prev) => ({ ...prev, blocks: prev.blocks.filter((_, j) => j !== i) }));
  }

  function moveBlock(i: number, dir: -1 | 1) {
    setEditor((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.blocks.length) return prev;
      const blocks = [...prev.blocks];
      [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
      return { ...prev, blocks };
    });
  }

  function addBlock(build: () => EditorBlock) {
    setEditor((prev) => ({ ...prev, blocks: [...prev.blocks, build()] }));
    setAddOpen(false);
  }

  async function shareResponderLink() {
    if (!responderUri) return;
    try { await Share.share({ message: responderUri, url: responderUri }); } catch {}
  }

  if (loading) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  const emailLabel = EMAIL_OPTIONS.find((o) => o.value === editor.emailCollection)?.label ?? 'Do not collect email';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerLabel}>Form Builder</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {editor.title?.trim() || 'Untitled form'}
          </Text>
        </View>
        <TouchableOpacity
          onPress={save}
          disabled={saving}
          style={[styles.saveBtn, saving && { opacity: 0.6 }]}
        >
          {saving
            ? <ActivityIndicator color={Colors.surface} size="small" />
            : <Text style={styles.saveBtnText}>Save</Text>}
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: 120 }}
        keyboardShouldPersistTaps="handled"
      >
        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Form title</Text>
          <TextInput
            style={[styles.input, styles.inputBig]}
            value={editor.title}
            onChangeText={(t) => setEditor((s) => ({ ...s, title: t }))}
            placeholder="Untitled form"
            placeholderTextColor={Colors.textMuted}
          />
          <Text style={styles.fieldLabel}>Description</Text>
          <TextInput
            style={[styles.input, styles.inputMulti]}
            value={editor.description}
            onChangeText={(t) => setEditor((s) => ({ ...s, description: t }))}
            placeholder="Shown under the title"
            placeholderTextColor={Colors.textMuted}
            multiline
          />

          <View style={styles.divider} />

          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Quiz mode</Text>
              <Text style={styles.fieldHint}>Mark questions correct/incorrect</Text>
            </View>
            <Switch
              value={editor.isQuiz}
              onValueChange={(v) => setEditor((s) => ({ ...s, isQuiz: v }))}
              trackColor={{ false: Colors.border, true: Colors.primary }}
              thumbColor={Colors.surface}
            />
          </View>

          <View style={styles.divider} />

          <Text style={styles.fieldLabel}>Email collection</Text>
          <TouchableOpacity style={styles.select} onPress={() => setEmailOpen(true)}>
            <Text style={styles.selectText}>{emailLabel}</Text>
            <Ionicons name="chevron-down" size={18} color={Colors.textMuted} />
          </TouchableOpacity>

          {responderUri ? (
            <>
              <View style={styles.divider} />
              <Text style={styles.fieldLabel}>Share link</Text>
              <View style={styles.linkRow}>
                <Text style={styles.linkText} numberOfLines={1}>{responderUri}</Text>
              </View>
              <View style={styles.linkActions}>
                <TouchableOpacity style={styles.smallBtn} onPress={shareResponderLink}>
                  <Ionicons name="share-outline" size={14} color={Colors.primary} />
                  <Text style={styles.smallBtnText}>Share link</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : null}
        </View>

        <View style={styles.sectionHeader}>
          <Ionicons name="list-outline" size={16} color={Colors.primary} />
          <Text style={styles.sectionTitle}>Questions &amp; content</Text>
        </View>

        {editor.blocks.length === 0 ? (
          <View style={styles.emptyHint}>
            <Text style={styles.emptyHintText}>No blocks yet. Tap the + button to add one.</Text>
          </View>
        ) : null}

        {editor.blocks.map((block, i) => (
          <BlockCard
            key={block.key}
            block={block}
            index={i}
            total={editor.blocks.length}
            onChange={(patch) => updateBlock(i, patch)}
            onRemove={() => removeBlock(i)}
            onMove={(dir) => moveBlock(i, dir)}
          />
        ))}
      </ScrollView>

      <TouchableOpacity style={styles.fab} onPress={() => setAddOpen(true)} activeOpacity={0.85}>
        <Ionicons name="add" size={28} color={Colors.surface} />
      </TouchableOpacity>

      {/* Email-collection picker */}
      <Modal visible={emailOpen} transparent animationType="fade" onRequestClose={() => setEmailOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setEmailOpen(false)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Email collection</Text>
            {EMAIL_OPTIONS.map((opt) => {
              const selected = editor.emailCollection === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={styles.modalRow}
                  onPress={() => {
                    setEditor((s) => ({ ...s, emailCollection: opt.value }));
                    setEmailOpen(false);
                  }}
                >
                  <Text style={[styles.modalRowText, selected && { color: Colors.primary, fontWeight: '700' }]}>
                    {opt.label}
                  </Text>
                  {selected ? <Ionicons name="checkmark" size={18} color={Colors.primary} /> : null}
                </TouchableOpacity>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Add-block picker */}
      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setAddOpen(false)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Add to form</Text>
            <View style={styles.addGrid}>
              {ADD_OPTIONS.map((opt) => (
                <TouchableOpacity key={opt.label} style={styles.addItem} onPress={() => addBlock(opt.build)}>
                  <Ionicons name={opt.icon} size={18} color={Colors.primary} />
                  <Text style={styles.addItemText}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

/* -------- Block card -------- */

function BlockCard({
  block, index, total, onChange, onRemove, onMove,
}: {
  block: EditorBlock;
  index: number;
  total: number;
  onChange: (patch: Partial<EditorBlock>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  return (
    <View style={styles.blockCard}>
      <View style={styles.blockHeader}>
        <View style={styles.kindBadge}>
          <Text style={styles.kindBadgeText}>{blockLabel(block.kind)}</Text>
        </View>
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          style={styles.iconBtnSmall}
          onPress={() => onMove(-1)}
          disabled={index === 0}
        >
          <Ionicons name="arrow-up" size={16} color={index === 0 ? Colors.textMuted : Colors.text} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.iconBtnSmall}
          onPress={() => onMove(1)}
          disabled={index === total - 1}
        >
          <Ionicons name="arrow-down" size={16} color={index === total - 1 ? Colors.textMuted : Colors.text} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconBtnSmall} onPress={onRemove}>
          <Ionicons name="trash-outline" size={16} color={Colors.error} />
        </TouchableOpacity>
      </View>

      {block.kind === 'unsupported' ? (
        <Text style={styles.hintText}>{block.hint}</Text>
      ) : null}

      <Text style={styles.fieldLabelSmall}>Title</Text>
      <TextInput
        style={styles.input}
        value={block.title}
        onChangeText={(t) => onChange({ title: t } as Partial<EditorBlock>)}
        placeholder={block.kind === 'section' ? 'Section title' : 'Question title'}
        placeholderTextColor={Colors.textMuted}
      />
      <Text style={styles.fieldLabelSmall}>Help text</Text>
      <TextInput
        style={[styles.input, styles.inputMulti]}
        value={block.description}
        onChangeText={(t) => onChange({ description: t } as Partial<EditorBlock>)}
        placeholder="Optional description"
        placeholderTextColor={Colors.textMuted}
        multiline
      />

      {/* Required toggle for all question types */}
      {block.kind !== 'section' && block.kind !== 'text_block' && block.kind !== 'unsupported' ? (
        <View style={styles.switchRow}>
          <Text style={styles.fieldLabel}>Required</Text>
          <Switch
            value={'required' in block ? Boolean(block.required) : false}
            onValueChange={(v) => onChange({ required: v } as Partial<EditorBlock>)}
            trackColor={{ false: Colors.border, true: Colors.primary }}
            thumbColor={Colors.surface}
          />
        </View>
      ) : null}

      {/* Choice options */}
      {(block.kind === 'multiple_choice' || block.kind === 'checkboxes' || block.kind === 'dropdown') ? (
        <ChoiceOptionsEditor block={block} onChange={onChange} />
      ) : null}

      {/* Linear scale */}
      {block.kind === 'linear_scale' ? (
        <LinearScaleEditor block={block} onChange={onChange} />
      ) : null}

      {/* Date */}
      {block.kind === 'date' ? (
        <View style={styles.toggleRow}>
          <ToggleField
            label="Include year"
            value={block.dateIncludeYear !== false}
            onChange={(v) => onChange({ dateIncludeYear: v } as Partial<EditorBlock>)}
          />
          <ToggleField
            label="Include time"
            value={Boolean(block.dateIncludeTime)}
            onChange={(v) => onChange({ dateIncludeTime: v } as Partial<EditorBlock>)}
          />
        </View>
      ) : null}

      {/* Time */}
      {block.kind === 'time' ? (
        <ToggleField
          label="Duration (elapsed time)"
          value={Boolean(block.timeDuration)}
          onChange={(v) => onChange({ timeDuration: v } as Partial<EditorBlock>)}
        />
      ) : null}
    </View>
  );
}

function ChoiceOptionsEditor({
  block,
  onChange,
}: {
  block: Extract<EditorBlock, { kind: 'multiple_choice' | 'checkboxes' | 'dropdown' }>;
  onChange: (patch: Partial<EditorBlock>) => void;
}) {
  const opts = block.choiceOptions || [];
  return (
    <View>
      <Text style={styles.fieldLabelSmall}>Options</Text>
      {opts.map((opt, j) => (
        <View key={j} style={styles.optionRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={opt}
            onChangeText={(t) => {
              const next = [...opts];
              next[j] = t;
              onChange({ choiceOptions: next } as Partial<EditorBlock>);
            }}
            placeholder={`Option ${j + 1}`}
            placeholderTextColor={Colors.textMuted}
          />
          <TouchableOpacity
            style={styles.optionRemove}
            onPress={() => {
              const next = opts.filter((_, k) => k !== j);
              onChange({ choiceOptions: next } as Partial<EditorBlock>);
            }}
          >
            <Ionicons name="close" size={16} color={Colors.error} />
          </TouchableOpacity>
        </View>
      ))}
      <TouchableOpacity
        style={styles.addOption}
        onPress={() => onChange({ choiceOptions: [...opts, `Option ${opts.length + 1}`] } as Partial<EditorBlock>)}
      >
        <Ionicons name="add" size={16} color={Colors.primary} />
        <Text style={styles.addOptionText}>Add option</Text>
      </TouchableOpacity>
      <View style={[styles.switchRow, { marginTop: 6 }]}>
        <Text style={styles.fieldHint}>Shuffle option order</Text>
        <Switch
          value={Boolean(block.shuffle)}
          onValueChange={(v) => onChange({ shuffle: v } as Partial<EditorBlock>)}
          trackColor={{ false: Colors.border, true: Colors.primary }}
          thumbColor={Colors.surface}
        />
      </View>
    </View>
  );
}

function LinearScaleEditor({
  block,
  onChange,
}: {
  block: Extract<EditorBlock, { kind: 'linear_scale' }>;
  onChange: (patch: Partial<EditorBlock>) => void;
}) {
  return (
    <View>
      <View style={styles.gridRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabelSmall}>Low</Text>
          <TextInput
            style={styles.input}
            value={String(block.scaleLow ?? 1)}
            onChangeText={(t) => onChange({ scaleLow: parseInt(t, 10) || 0 } as Partial<EditorBlock>)}
            keyboardType="number-pad"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabelSmall}>High</Text>
          <TextInput
            style={styles.input}
            value={String(block.scaleHigh ?? 5)}
            onChangeText={(t) => onChange({ scaleHigh: parseInt(t, 10) || 0 } as Partial<EditorBlock>)}
            keyboardType="number-pad"
          />
        </View>
      </View>
      <View style={styles.gridRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabelSmall}>Low label</Text>
          <TextInput
            style={styles.input}
            value={block.scaleLowLabel || ''}
            onChangeText={(t) => onChange({ scaleLowLabel: t } as Partial<EditorBlock>)}
            placeholder="e.g. Poor"
            placeholderTextColor={Colors.textMuted}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabelSmall}>High label</Text>
          <TextInput
            style={styles.input}
            value={block.scaleHighLabel || ''}
            onChangeText={(t) => onChange({ scaleHighLabel: t } as Partial<EditorBlock>)}
            placeholder="e.g. Excellent"
            placeholderTextColor={Colors.textMuted}
          />
        </View>
      </View>
    </View>
  );
}

function ToggleField({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.switchRow}>
      <Text style={styles.fieldHint}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: Colors.border, true: Colors.primary }}
        thumbColor={Colors.surface}
      />
    </View>
  );
}

/* -------- styles -------- */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  scroll: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  iconBtn: { padding: 6 },
  iconBtnSmall: { padding: 6, marginLeft: 2 },
  headerLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: Colors.textMuted, textTransform: 'uppercase' },
  headerTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  saveBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 18, paddingVertical: 9,
    borderRadius: 8, minWidth: 64, alignItems: 'center',
  },
  saveBtnText: { color: Colors.surface, fontWeight: '700', fontSize: 13 },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  divider: { height: 1, backgroundColor: Colors.borderLight, marginVertical: 6 },

  fieldLabel: { fontSize: 12, fontWeight: '700', color: Colors.text },
  fieldLabelSmall: { fontSize: 11, fontWeight: '600', color: Colors.textSecondary, marginTop: 6, marginBottom: 4 },
  fieldHint: { fontSize: 12, color: Colors.textSecondary },

  input: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: Colors.text, backgroundColor: Colors.surface,
  },
  inputBig: { fontSize: 15, fontWeight: '600' },
  inputMulti: { minHeight: 64, textAlignVertical: 'top' },

  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 4 },

  select: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: Colors.border, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 11,
    backgroundColor: Colors.surface,
  },
  selectText: { fontSize: 14, color: Colors.text },

  linkRow: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: 8,
    padding: 10, backgroundColor: Colors.background,
  },
  linkText: { fontSize: 12, color: Colors.textSecondary, fontFamily: 'Menlo' },
  linkActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  smallBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 7,
    borderWidth: 1, borderColor: Colors.border, borderRadius: 6,
  },
  smallBtnText: { fontSize: 12, fontWeight: '600', color: Colors.primary },

  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4, marginTop: 8,
  },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: Colors.text },
  emptyHint: {
    padding: 18, borderRadius: 12, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border, borderStyle: 'dashed',
    alignItems: 'center',
  },
  emptyHintText: { fontSize: 13, color: Colors.textMuted },

  blockCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    gap: 6,
    borderWidth: 1, borderColor: Colors.borderLight,
  },
  blockHeader: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  kindBadge: {
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
  },
  kindBadgeText: { fontSize: 10, fontWeight: '700', color: Colors.primary, textTransform: 'uppercase', letterSpacing: 0.6 },
  hintText: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17, marginVertical: 4 },

  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  optionRemove: { padding: 8 },
  addOption: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6 },
  addOptionText: { fontSize: 13, fontWeight: '600', color: Colors.primary },

  gridRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  toggleRow: { flexDirection: 'column', gap: 0 },

  fab: {
    position: 'absolute',
    right: 18, bottom: 24,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 10, elevation: 6,
  },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 18, paddingBottom: 30, gap: 6,
  },
  modalTitle: { fontSize: 15, fontWeight: '700', color: Colors.text, marginBottom: 8 },
  modalRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  modalRowText: { fontSize: 14, color: Colors.text },

  addGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  addItem: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    backgroundColor: Colors.background,
    minWidth: '47%',
  },
  addItemText: { fontSize: 13, fontWeight: '600', color: Colors.text },

  errorBox: {
    backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FEE2E2',
    padding: 10, borderRadius: 8,
  },
  errorText: { fontSize: 12, color: Colors.error },
});
