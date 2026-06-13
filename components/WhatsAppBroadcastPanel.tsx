import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { Colors } from '../constants/colors';
import { broadcastApi, whatsappApi, type WaMergeParseResult } from '../lib/api';
import { normalizePhoneList } from '../lib/broadcast-phones';
import {
  applyTemplatePreview,
  autoMapColumns,
  templateVariableDisplayLabels,
  type ColumnMapping,
} from '../lib/whatsapp-broadcast';
import type { WhatsAppTemplateMeta } from './whatsapp/WhatsAppTemplatePanel';

type BroadcastMode = 'template' | 'session';

const WA_GREEN = '#25D366';

type DropdownOption<T> = { value: T; label: string };

function DropdownSelect<T extends string | number>({
  value,
  options,
  onChange,
  placeholder = 'Select…',
  disabled = false,
}: {
  value: T | null;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <>
      <TouchableOpacity
        style={[styles.dropdown, disabled && styles.dropdownDisabled]}
        onPress={() => !disabled && setOpen(true)}
        activeOpacity={0.7}
      >
        <Text
          style={[styles.dropdownText, !selected && styles.dropdownPlaceholder]}
          numberOfLines={1}
        >
          {selected?.label ?? placeholder}
        </Text>
        <Ionicons name="chevron-down" size={16} color={Colors.textMuted} />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.dropdownMenu} onPress={(e) => e.stopPropagation()}>
            <ScrollView style={styles.dropdownMenuScroll} keyboardShouldPersistTaps="handled">
              {options.map((opt) => {
                const active = opt.value === value;
                return (
                  <TouchableOpacity
                    key={String(opt.value)}
                    style={[styles.dropdownOption, active && styles.dropdownOptionActive]}
                    onPress={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                  >
                    <Text
                      style={[styles.dropdownOptionText, active && styles.dropdownOptionTextActive]}
                      numberOfLines={2}
                    >
                      {opt.label}
                    </Text>
                    {active ? <Ionicons name="checkmark" size={16} color={WA_GREEN} /> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function mapTemplates(
  raw: Array<{
    name: string;
    languageCode?: string;
    bodyParamCount: number;
    label: string;
    preview?: string;
    previewExample?: string;
  }>
): WhatsAppTemplateMeta[] {
  return raw.map((t) => ({
    name: t.name,
    languageCode: t.languageCode,
    bodyParamCount: t.bodyParamCount,
    label: t.label,
    preview: t.preview ?? t.previewExample,
  }));
}

export function WhatsAppBroadcastPanel() {
  const [mode, setMode] = useState<BroadcastMode>('template');
  const [templates, setTemplates] = useState<WhatsAppTemplateMeta[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [selectedTemplate, setSelectedTemplate] = useState<WhatsAppTemplateMeta | null>(null);

  const [parseResult, setParseResult] = useState<WaMergeParseResult | null>(null);
  const [parseBusy, setParseBusy] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping[]>([]);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [mappingOpen, setMappingOpen] = useState(false);

  const [recipients, setRecipients] = useState<string[]>([]);
  const [manualInput, setManualInput] = useState('');
  const [sessionParseBusy, setSessionParseBusy] = useState(false);
  const [sessionParseError, setSessionParseError] = useState<string | null>(null);
  const [body, setBody] = useState('');

  const [sendBusy, setSendBusy] = useState(false);
  const [sendResult, setSendResult] = useState<{
    sent: number;
    failed: { phone: string; error: string }[];
  } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  useEffect(() => {
    whatsappApi
      .status()
      .then((d) => {
        const tmpl = mapTemplates(d.templates ?? []);
        setTemplates(tmpl);
        if (tmpl.length > 0) setSelectedTemplate(tmpl[0]);
      })
      .catch(() => {})
      .finally(() => setTemplatesLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedTemplate || !parseResult) return;
    const labels = templateVariableDisplayLabels(selectedTemplate);
    setMapping(autoMapColumns(parseResult.headers, labels));
    setPreviewIdx(0);
  }, [selectedTemplate, parseResult]);

  useEffect(() => {
    if (!parseResult && selectedTemplate) {
      const labels = templateVariableDisplayLabels(selectedTemplate);
      setMapping(labels.map(() => null));
    }
  }, [selectedTemplate, parseResult]);

  const varLabels = useMemo(
    () => (selectedTemplate ? templateVariableDisplayLabels(selectedTemplate) : []),
    [selectedTemplate]
  );

  const mergeRecipients = useCallback((more: string[]) => {
    setRecipients((prev) => Array.from(new Set([...prev, ...more])));
  }, []);

  const applyManual = useCallback(() => {
    const next = normalizePhoneList(manualInput);
    if (next.length) mergeRecipients(next);
    setManualInput('');
  }, [manualInput, mergeRecipients]);

  async function pickMergeFile() {
    setParseError(null);
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        'text/csv',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ],
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    setParseBusy(true);
    try {
      const data = await broadcastApi.parseWaMergeFile(
        asset.uri,
        asset.name,
        asset.mimeType ?? 'application/octet-stream'
      );
      if (data.rows.length === 0) {
        setParseError(
          'No valid phone numbers found. Use a column named Phone, Mobile, or Tel with E.164 numbers (e.g. +91 98765 43210).'
        );
      } else {
        setParseResult(data);
      }
    } catch (e: unknown) {
      setParseError(e instanceof Error ? e.message : 'Parse failed');
    } finally {
      setParseBusy(false);
    }
  }

  async function pickSessionFile() {
    setSessionParseError(null);
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        'text/csv',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ],
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    setSessionParseBusy(true);
    try {
      const data = await broadcastApi.parsePhonesFile(
        asset.uri,
        asset.name,
        asset.mimeType ?? 'application/octet-stream'
      );
      const phones = data.phones ?? [];
      if (phones.length === 0) {
        setSessionParseError('No phone numbers found. Use a column named Phone, Mobile, or Tel.');
      } else {
        mergeRecipients(phones);
      }
    } catch (e: unknown) {
      setSessionParseError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setSessionParseBusy(false);
    }
  }

  async function sendBroadcast() {
    setSendError(null);
    setSendResult(null);

    if (mode === 'template') {
      if (!selectedTemplate) {
        setSendError('Select a template first.');
        return;
      }
      if (!parseResult || parseResult.rows.length === 0) {
        setSendError('Upload a CSV with recipients.');
        return;
      }
      const rows = parseResult.rows.map((row) => ({
        phone: row.phone,
        variables: mapping.map((idx) => (idx !== null ? row.cells[idx] ?? '' : '')),
      }));
      setSendBusy(true);
      try {
        const res = await broadcastApi.sendWhatsApp({
          mode: 'template',
          templateName: selectedTemplate.name,
          templateLanguage: selectedTemplate.languageCode,
          rows,
        });
        setSendResult({ sent: res.sent ?? 0, failed: res.failed ?? [] });
        showSendAlert(res.sent ?? 0, res.failed ?? []);
      } catch (e: unknown) {
        setSendError(e instanceof Error ? e.message : 'Send failed');
      } finally {
        setSendBusy(false);
      }
      return;
    }

    if (recipients.length === 0) {
      setSendError('Add recipients.');
      return;
    }
    if (!body.trim()) {
      setSendError('Enter the message to send.');
      return;
    }
    setSendBusy(true);
    try {
      const res = await broadcastApi.sendWhatsApp({ recipients, text: body.trim() });
      setSendResult({ sent: res.sent ?? 0, failed: res.failed ?? [] });
      showSendAlert(res.sent ?? 0, res.failed ?? []);
      if ((res.failed?.length ?? 0) === 0) {
        setBody('');
        setRecipients([]);
      }
    } catch (e: unknown) {
      setSendError(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setSendBusy(false);
    }
  }

  function showSendAlert(sent: number, failed: { phone: string; error: string }[]) {
    if (failed.length > 0) {
      const sample = failed.slice(0, 3).map((f) => `• ${f.phone}: ${f.error}`).join('\n');
      const more = failed.length > 3 ? `\n…and ${failed.length - 3} more` : '';
      Alert.alert(`Sent ${sent}`, `${failed.length} failed:\n${sample}${more}`);
    } else {
      Alert.alert('Sent!', `WhatsApp sent to ${sent} recipient${sent !== 1 ? 's' : ''}.`);
    }
  }

  const currentPreviewRow = parseResult?.rows[previewIdx];
  const currentPreviewText =
    selectedTemplate && currentPreviewRow
      ? applyTemplatePreview(
          selectedTemplate,
          mapping.map((idx) => (idx !== null ? currentPreviewRow.cells[idx] ?? '' : ''))
        )
      : selectedTemplate
      ? applyTemplatePreview(selectedTemplate, varLabels.map(() => '…'))
      : '';

  const canSend =
    !sendBusy &&
    (mode === 'template'
      ? !!selectedTemplate && (parseResult?.rows.length ?? 0) > 0
      : recipients.length > 0 && body.trim().length > 0);

  return (
    <View style={styles.wrap}>
      <View style={styles.modeRow}>
        {(['template', 'session'] as BroadcastMode[]).map((m) => (
          <TouchableOpacity
            key={m}
            style={[styles.modeBtn, mode === m && styles.modeBtnActive]}
            onPress={() => {
              setMode(m);
              setSendResult(null);
              setSendError(null);
            }}
          >
            <Text style={[styles.modeBtnText, mode === m && styles.modeBtnTextActive]}>
              {m === 'template' ? 'Template + CSV' : 'Session message'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {mode === 'template' ? (
        <ScrollView contentContainerStyle={styles.scrollContent} nestedScrollEnabled>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Template</Text>
            {templatesLoading ? (
              <ActivityIndicator color={WA_GREEN} />
            ) : templates.length === 0 ? (
              <Text style={styles.warnText}>No templates found. Configure WhatsApp templates first.</Text>
            ) : (
              <DropdownSelect
                value={selectedTemplate?.name ?? null}
                placeholder="Select template"
                options={templates.map((t) => ({ value: t.name, label: t.label }))}
                onChange={(name) => {
                  const t = templates.find((x) => x.name === name);
                  if (t) setSelectedTemplate(t);
                }}
              />
            )}

            {selectedTemplate ? (
              <View style={styles.previewBubble}>
                <Text style={styles.previewLabel}>Preview</Text>
                <Text style={styles.previewText}>{currentPreviewText}</Text>
                {parseResult && parseResult.rows.length > 1 ? (
                  <View style={styles.previewNav}>
                    <TouchableOpacity
                      onPress={() => setPreviewIdx(Math.max(0, previewIdx - 1))}
                      disabled={previewIdx === 0}
                    >
                      <Text style={styles.previewNavBtn}>‹</Text>
                    </TouchableOpacity>
                    <Text style={styles.previewNavLabel}>
                      Row {previewIdx + 1} of {parseResult.rows.length}
                    </Text>
                    <TouchableOpacity
                      onPress={() =>
                        setPreviewIdx(Math.min(parseResult.rows.length - 1, previewIdx + 1))
                      }
                      disabled={previewIdx >= parseResult.rows.length - 1}
                    >
                      <Text style={styles.previewNavBtn}>›</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            ) : null}

            <TouchableOpacity style={styles.importBtn} onPress={() => void pickMergeFile()} disabled={parseBusy}>
              {parseBusy ? (
                <ActivityIndicator size="small" color={WA_GREEN} />
              ) : (
                <Ionicons name="cloud-upload-outline" size={18} color={WA_GREEN} />
              )}
              <Text style={styles.importBtnText}>{parseBusy ? 'Reading…' : 'Import CSV / Excel'}</Text>
            </TouchableOpacity>
            {parseError ? <Text style={styles.errorText}>{parseError}</Text> : null}
            {parseResult ? (
              <Text style={styles.metaText}>
                {parseResult.rows.length} row{parseResult.rows.length !== 1 ? 's' : ''} loaded
                {parseResult.truncated ? ' (truncated to 200)' : ''}
                {(parseResult.skipped ?? 0) > 0
                  ? ` · ${parseResult.skipped} skipped (invalid phone)`
                  : ''}
              </Text>
            ) : (
              <Text style={styles.hintText}>
                Expected: Phone, Name, Sender columns. Phone column is auto-detected.
              </Text>
            )}
          </View>

          {parseResult && varLabels.length > 0 ? (
            <View style={styles.card}>
              <TouchableOpacity style={styles.mappingHeader} onPress={() => setMappingOpen(!mappingOpen)}>
                <Text style={styles.sectionTitle}>Column mapping</Text>
                <Ionicons
                  name={mappingOpen ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={Colors.textMuted}
                />
              </TouchableOpacity>
              {mappingOpen ? (
                <View style={styles.mappingList}>
                  {varLabels.map((label, vi) => (
                    <View key={vi} style={styles.mappingRow}>
                      <View style={styles.mappingLabelRow}>
                        <Text style={styles.mappingSlot}>{vi + 1}</Text>
                        <Text style={styles.mappingLabel} numberOfLines={1}>
                          {label}
                        </Text>
                      </View>
                      <DropdownSelect
                        value={mapping[vi] ?? -1}
                        placeholder="— skip —"
                        options={[
                          { value: -1, label: '— skip —' },
                          ...parseResult.headers.map((h, hi) => ({
                            value: hi,
                            label: h || `Column ${hi + 1}`,
                          })),
                        ]}
                        onChange={(hi) =>
                          setMapping((prev) => {
                            const next = [...prev];
                            next[vi] = hi === -1 ? null : hi;
                            return next;
                          })
                        }
                      />
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}

          {parseResult && parseResult.rows.length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Recipients ({parseResult.rows.length})</Text>
              <ScrollView style={styles.recipientScroll} nestedScrollEnabled>
                {parseResult.rows.slice(0, 50).map((row, ri) => (
                  <TouchableOpacity
                    key={`${row.phone}-${ri}`}
                    style={[styles.recipientRow, ri === previewIdx && styles.recipientRowActive]}
                    onPress={() => setPreviewIdx(ri)}
                  >
                    <Text style={styles.recipientPhone}>{row.phone}</Text>
                    <Text style={styles.recipientCells} numberOfLines={1}>
                      {row.cells.join(' · ')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              {parseResult.rows.length > 50 ? (
                <Text style={styles.metaText}>Showing first 50 of {parseResult.rows.length}</Text>
              ) : null}
              <TouchableOpacity onPress={() => setParseResult(null)}>
                <Text style={styles.clearText}>Clear list</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </ScrollView>
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Recipients</Text>
            <TouchableOpacity
              style={styles.importBtn}
              onPress={() => void pickSessionFile()}
              disabled={sessionParseBusy}
            >
              {sessionParseBusy ? (
                <ActivityIndicator size="small" color={WA_GREEN} />
              ) : (
                <Ionicons name="cloud-upload-outline" size={18} color={WA_GREEN} />
              )}
              <Text style={styles.importBtnText}>
                {sessionParseBusy ? 'Reading…' : 'Import CSV / Excel'}
              </Text>
            </TouchableOpacity>
            {sessionParseError ? <Text style={styles.errorText}>{sessionParseError}</Text> : null}

            <Text style={styles.label}>Or paste numbers (E.164)</Text>
            <TextInput
              style={[styles.input, styles.recipientsInput]}
              value={manualInput}
              onChangeText={setManualInput}
              placeholder="+919876543210, +447700900123"
              placeholderTextColor={Colors.textMuted}
              multiline
            />
            <TouchableOpacity style={styles.addBtn} onPress={applyManual}>
              <Ionicons name="add" size={16} color={WA_GREEN} />
              <Text style={styles.addBtnText}>Add to list</Text>
            </TouchableOpacity>

            {recipients.length > 0 ? (
              <View style={styles.recipientList}>
                {recipients.map((phone) => (
                  <View key={phone} style={styles.recipientChip}>
                    <Text style={styles.recipientPhone}>{phone}</Text>
                    <TouchableOpacity onPress={() => setRecipients((r) => r.filter((x) => x !== phone))}>
                      <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                ))}
                <TouchableOpacity onPress={() => setRecipients([])}>
                  <Text style={styles.clearText}>Clear all</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <Text style={styles.hintText}>No recipients yet</Text>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Message</Text>
            <TextInput
              style={[styles.input, styles.bodyInput]}
              value={body}
              onChangeText={setBody}
              placeholder="Session message sent individually to each recipient…"
              placeholderTextColor={Colors.textMuted}
              multiline
              textAlignVertical="top"
            />
          </View>
        </>
      )}

      {sendError ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{sendError}</Text>
        </View>
      ) : null}
      {sendResult ? (
        <View style={styles.successBox}>
          <Text style={styles.successText}>
            Sent: {sendResult.sent}
            {sendResult.failed.length > 0 ? ` · Failed: ${sendResult.failed.length}` : ''}
          </Text>
        </View>
      ) : null}

      <TouchableOpacity
        style={[styles.sendBtn, !canSend && { opacity: 0.6 }]}
        onPress={() => void sendBroadcast()}
        disabled={!canSend}
      >
        {sendBusy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Ionicons name="logo-whatsapp" size={20} color="#fff" />
            <Text style={styles.sendBtnText}>
              {mode === 'template'
                ? `Send to ${parseResult?.rows.length ?? 0} recipients`
                : `Send to ${recipients.length} recipients`}
            </Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  scrollContent: { gap: 16, paddingBottom: 8 },
  modeRow: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 4,
    gap: 4,
  },
  modeBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  modeBtnActive: { backgroundColor: '#E8F8EE' },
  modeBtnText: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  modeBtnTextActive: { color: WA_GREEN, fontWeight: '700' },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    gap: 12,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  label: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: Colors.background,
  },
  dropdownDisabled: { opacity: 0.5 },
  dropdownText: { flex: 1, fontSize: 14, color: Colors.text },
  dropdownPlaceholder: { color: Colors.textMuted },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 24,
  },
  dropdownMenu: {
    maxHeight: 320,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 8,
  },
  dropdownMenuScroll: { maxHeight: 320 },
  dropdownOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  dropdownOptionActive: { backgroundColor: '#E8F8EE' },
  dropdownOptionText: { flex: 1, fontSize: 14, color: Colors.text },
  dropdownOptionTextActive: { color: WA_GREEN, fontWeight: '600' },
  previewBubble: {
    backgroundColor: '#DCF8C6',
    borderRadius: 10,
    padding: 12,
    gap: 6,
  },
  previewLabel: { fontSize: 10, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase' },
  previewText: { fontSize: 14, lineHeight: 20, color: '#1F2937' },
  previewNav: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  previewNavBtn: { fontSize: 18, color: Colors.textMuted, paddingHorizontal: 6 },
  previewNavLabel: { fontSize: 12, color: Colors.textMuted },
  importBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    borderStyle: 'dashed',
  },
  importBtnText: { fontSize: 13, color: WA_GREEN, fontWeight: '600' },
  hintText: { fontSize: 12, color: Colors.textMuted, lineHeight: 18 },
  metaText: { fontSize: 12, color: Colors.textSecondary },
  warnText: { fontSize: 12, color: Colors.warning },
  mappingHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  mappingList: { gap: 12 },
  mappingRow: { gap: 8 },
  mappingLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mappingSlot: {
    width: 22,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '700',
    color: WA_GREEN,
    backgroundColor: '#E8F8EE',
    borderRadius: 4,
    overflow: 'hidden',
    paddingVertical: 2,
  },
  mappingLabel: { flex: 1, fontSize: 12, color: Colors.textSecondary },
  recipientScroll: { maxHeight: 200 },
  recipientRow: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
    gap: 2,
  },
  recipientRowActive: { backgroundColor: '#E8F8EE' },
  recipientPhone: { fontSize: 12, fontWeight: '600', fontFamily: 'monospace', color: Colors.text },
  recipientCells: { fontSize: 11, color: Colors.textMuted },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: Colors.text,
    backgroundColor: Colors.background,
  },
  recipientsInput: { minHeight: 80 },
  bodyInput: { minHeight: 140 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  addBtnText: { fontSize: 13, fontWeight: '600', color: WA_GREEN },
  recipientList: { gap: 6 },
  recipientChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: Colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  clearText: { fontSize: 12, fontWeight: '600', color: Colors.error, marginTop: 4 },
  errorBox: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  errorText: { fontSize: 13, color: Colors.error },
  successBox: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  successText: { fontSize: 13, fontWeight: '600', color: '#047857' },
  sendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 15,
    borderRadius: 12,
    backgroundColor: WA_GREEN,
    minHeight: 50,
  },
  sendBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
});
