import React, { useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { Colors } from '../constants/colors';
import { mailMergeApi, type MailMergeRow } from '../lib/api';
import { mergeTemplate, listPlaceholdersInTemplate } from '../lib/mail-merge';
import { readFileAsBase64 } from '../lib/gmail-send-direct';

// Vercel JSON body limit: ~4.5 MB. Base64 inflates ~1.37x, so cap raw at 3 MB.
const MAX_TOTAL_ATTACH_BYTES = 3 * 1024 * 1024;

type PickedAttachment = {
  name: string;
  mimeType: string;
  size: number;
  uri: string;
  base64Data?: string;
  status: 'preparing' | 'ready' | 'error';
  errorMsg?: string;
};

const DEFAULT_SUBJECT = 'Placement update for {{name}}';
const DEFAULT_BODY =
  'Dear {{name}},\n\nWe are reaching out from the placement office.\n\nBest regards,\nPlacement Team';

export function MailMergePanel() {
  const [rows, setRows] = useState<MailMergeRow[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [importInfo, setImportInfo] = useState<string | null>(null);
  const [parseBusy, setParseBusy] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const [subjectTemplate, setSubjectTemplate] = useState(DEFAULT_SUBJECT);
  const [bodyTemplate, setBodyTemplate] = useState(DEFAULT_BODY);
  const [previewIndex, setPreviewIndex] = useState(0);

  const [attachments, setAttachments] = useState<PickedAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{
    sent: number;
    failed: { email: string; error: string }[];
  } | null>(null);

  const previewRow = rows[previewIndex] ?? rows[0];
  const previewSubject = useMemo(
    () => (previewRow ? mergeTemplate(subjectTemplate, previewRow.fields) : ''),
    [previewRow, subjectTemplate]
  );
  const previewBody = useMemo(
    () => (previewRow ? mergeTemplate(bodyTemplate, previewRow.fields) : ''),
    [previewRow, bodyTemplate]
  );

  const placeholderHints = useMemo(() => {
    const keys = new Set([
      ...listPlaceholdersInTemplate(subjectTemplate),
      ...listPlaceholdersInTemplate(bodyTemplate),
    ]);
    if (columns.length) {
      for (const c of columns) keys.add(c);
    }
    return Array.from(keys).filter((k) => k !== 'email');
  }, [subjectTemplate, bodyTemplate, columns]);

  const totalAttachBytes = attachments.reduce((n, a) => n + a.size, 0);
  const overLimit = totalAttachBytes > MAX_TOTAL_ATTACH_BYTES;
  const hasPreparing = attachments.some((a) => a.status === 'preparing');

  async function pickFile() {
    setParseError(null);
    setImportInfo(null);
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        'text/csv',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.oasis.opendocument.spreadsheet',
      ],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setParseBusy(true);
    try {
      const parsed = await mailMergeApi.parseFile(
        asset.uri,
        asset.name,
        asset.mimeType ?? 'application/octet-stream'
      );
      setRows(parsed.rows);
      setColumns(parsed.columns);
      setPreviewIndex(0);
      const skipped = parsed.skipped ? ` · skipped ${parsed.skipped}` : '';
      const truncated = parsed.truncated ? ` · capped at ${parsed.maxRows}` : '';
      setImportInfo(`Imported ${parsed.rows.length} row${parsed.rows.length !== 1 ? 's' : ''}${skipped}${truncated}`);
    } catch (e: any) {
      setParseError(e?.message ?? 'Could not parse file');
    } finally {
      setParseBusy(false);
    }
  }

  async function pickAttachment() {
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
      multiple: true,
    });
    if (result.canceled) return;
    for (const a of result.assets) {
      const file: PickedAttachment = {
        name: a.name,
        mimeType: a.mimeType ?? 'application/octet-stream',
        size: a.size ?? 0,
        uri: a.uri,
        status: 'preparing',
      };
      setAttachments((prev) => [...prev, file]);
      readFileAsBase64(a.uri)
        .then((base64Data) => {
          setAttachments((prev) =>
            prev.map((p) => (p.uri === a.uri ? { ...p, status: 'ready', base64Data } : p))
          );
        })
        .catch((e) => {
          setAttachments((prev) =>
            prev.map((p) => (p.uri === a.uri ? { ...p, status: 'error', errorMsg: e?.message ?? 'Read failed' } : p))
          );
        });
    }
  }

  function removeAttachment(uri: string) {
    setAttachments((prev) => prev.filter((a) => a.uri !== uri));
  }

  async function send() {
    if (rows.length === 0) {
      Alert.alert('No recipients', 'Import a CSV/Excel file first.');
      return;
    }
    if (!subjectTemplate.trim()) {
      Alert.alert('Subject required', 'Enter a subject template.');
      return;
    }
    if (!bodyTemplate.trim()) {
      Alert.alert('Body required', 'Enter a message body template.');
      return;
    }
    if (hasPreparing) {
      Alert.alert('Please wait', 'Attachments are still being prepared.');
      return;
    }
    if (overLimit) {
      Alert.alert(
        'Attachments too large',
        `Total ${(totalAttachBytes / 1024 / 1024).toFixed(1)} MB exceeds the 3 MB limit.`
      );
      return;
    }

    const readyAttachments = attachments
      .filter((a): a is PickedAttachment & { base64Data: string } => a.status === 'ready' && !!a.base64Data)
      .map((a) => ({ filename: a.name, mimeType: a.mimeType, base64Data: a.base64Data }));

    setSending(true);
    setSendResult(null);
    try {
      const res = await mailMergeApi.send({
        subjectTemplate: subjectTemplate.trim(),
        bodyTemplate,
        rows,
        attachments: readyAttachments.length > 0 ? readyAttachments : undefined,
      });
      setSendResult({ sent: res.sent, failed: res.failed ?? [] });
      const failedCount = res.failed?.length ?? 0;
      if (failedCount === 0) {
        Alert.alert('Sent!', `Mail merge sent to ${res.sent} recipient${res.sent !== 1 ? 's' : ''}.`);
      } else {
        const sample = res.failed.slice(0, 3).map((f) => `• ${f.email}: ${f.error}`).join('\n');
        const more = failedCount > 3 ? `\n…and ${failedCount - 3} more` : '';
        Alert.alert(
          `Sent ${res.sent}/${res.recipients}`,
          `${failedCount} failed:\n${sample}${more}`
        );
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Send failed');
    } finally {
      setSending(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 32, gap: 14 }}>
      {/* Step 1: import file */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>1. Recipients</Text>
        <Text style={styles.hint}>
          Import a CSV or Excel file. Row 1 should be column headers
          (one of them an "Email" column). Other columns become merge
          fields you can use as <Text style={styles.code}>{'{{name}}'}</Text>,{' '}
          <Text style={styles.code}>{'{{phone}}'}</Text>, etc.
        </Text>

        <TouchableOpacity style={styles.fileBtn} onPress={pickFile} disabled={parseBusy}>
          {parseBusy
            ? <ActivityIndicator color={Colors.copper} size="small" />
            : <Ionicons name="cloud-upload-outline" size={18} color={Colors.copper} />}
          <Text style={styles.fileBtnText}>
            {parseBusy ? 'Reading…' : 'Choose file'}
          </Text>
        </TouchableOpacity>

        {importInfo && <Text style={styles.infoText}>{importInfo}</Text>}
        {parseError && <Text style={styles.errorText}>{parseError}</Text>}

        {rows.length > 0 && (
          <View style={{ marginTop: 8 }}>
            <Text style={styles.subLabel}>Recipients ({rows.length})</Text>
            <View style={styles.chipRow}>
              {rows.slice(0, 12).map((r) => (
                <View key={r.email} style={styles.chip}>
                  <Text style={styles.chipText} numberOfLines={1}>{r.email}</Text>
                </View>
              ))}
              {rows.length > 12 && (
                <Text style={styles.moreText}>+{rows.length - 12} more</Text>
              )}
            </View>
          </View>
        )}

        {columns.length > 0 && (
          <View style={{ marginTop: 6 }}>
            <Text style={styles.subLabel}>Available fields</Text>
            <View style={styles.chipRow}>
              {columns.filter((c) => c !== 'email').map((c) => (
                <View key={c} style={[styles.chip, styles.fieldChip]}>
                  <Text style={[styles.chipText, { color: Colors.copper }]}>{`{{${c}}}`}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </View>

      {/* Step 2: templates */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>2. Message</Text>
        <Text style={styles.hint}>
          Use <Text style={styles.code}>{'{{field}}'}</Text> placeholders.
          Common: <Text style={styles.code}>{'{{name}}'}</Text>,{' '}
          <Text style={styles.code}>{'{{phone}}'}</Text>,{' '}
          <Text style={styles.code}>{'{{company}}'}</Text>.
        </Text>

        <Text style={styles.label}>Subject template</Text>
        <TextInput
          style={styles.input}
          value={subjectTemplate}
          onChangeText={setSubjectTemplate}
          placeholder="Hello {{name}}"
          placeholderTextColor={Colors.textMuted}
        />

        <Text style={styles.label}>Body template</Text>
        <TextInput
          style={[styles.input, styles.bodyInput]}
          value={bodyTemplate}
          onChangeText={setBodyTemplate}
          multiline
          textAlignVertical="top"
          placeholder="Dear {{name}}, …"
          placeholderTextColor={Colors.textMuted}
        />

        {placeholderHints.length > 0 && (
          <Text style={styles.placeholderHint}>
            Using: {placeholderHints.map((p) => `{{${p}}}`).join(', ')}
          </Text>
        )}
      </View>

      {/* Step 3: preview */}
      {rows.length > 0 && previewRow && (
        <View style={styles.card}>
          <View style={styles.previewHeader}>
            <Text style={styles.sectionTitle}>3. Preview</Text>
            <View style={styles.previewNav}>
              <TouchableOpacity
                onPress={() => setPreviewIndex(Math.max(0, previewIndex - 1))}
                disabled={previewIndex === 0}
                style={[styles.previewNavBtn, previewIndex === 0 && { opacity: 0.4 }]}
              >
                <Ionicons name="chevron-back" size={16} color={Colors.text} />
              </TouchableOpacity>
              <Text style={styles.previewNavText}>
                {previewIndex + 1} / {rows.length}
              </Text>
              <TouchableOpacity
                onPress={() => setPreviewIndex(Math.min(rows.length - 1, previewIndex + 1))}
                disabled={previewIndex >= rows.length - 1}
                style={[styles.previewNavBtn, previewIndex >= rows.length - 1 && { opacity: 0.4 }]}
              >
                <Ionicons name="chevron-forward" size={16} color={Colors.text} />
              </TouchableOpacity>
            </View>
          </View>
          <Text style={styles.previewTo}>To: {previewRow.email}</Text>
          <Text style={styles.previewSubject}>{previewSubject || '(no subject)'}</Text>
          <Text style={styles.previewBody}>{previewBody}</Text>
        </View>
      )}

      {/* Step 4: attachments */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>4. Attachments (optional)</Text>
        <TouchableOpacity style={styles.fileBtn} onPress={pickAttachment}>
          <Ionicons name="attach-outline" size={18} color={Colors.copper} />
          <Text style={styles.fileBtnText}>Add attachment</Text>
        </TouchableOpacity>

        {attachments.length > 0 && (
          <View style={{ gap: 6, marginTop: 4 }}>
            {attachments.map((a) => (
              <View key={a.uri} style={styles.attachChip}>
                {a.status === 'preparing' ? (
                  <ActivityIndicator size="small" color={Colors.copper} />
                ) : a.status === 'error' ? (
                  <Ionicons name="warning-outline" size={14} color={Colors.error} />
                ) : (
                  <Ionicons name="document-outline" size={14} color={Colors.copper} />
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.attachChipName} numberOfLines={1}>{a.name}</Text>
                  <Text style={styles.attachChipSize}>
                    {a.status === 'preparing'
                      ? 'Preparing…'
                      : a.status === 'error'
                      ? a.errorMsg ?? 'Failed'
                      : `${(a.size / 1024).toFixed(1)} KB`}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => removeAttachment(a.uri)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                  <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
                </TouchableOpacity>
              </View>
            ))}
            {overLimit && (
              <Text style={styles.errorText}>
                Total {(totalAttachBytes / 1024 / 1024).toFixed(1)} MB — over the 3 MB limit.
              </Text>
            )}
          </View>
        )}
      </View>

      {/* Step 5: send */}
      <TouchableOpacity
        style={[
          styles.sendBtn,
          (sending || rows.length === 0 || hasPreparing || overLimit) && { opacity: 0.6 },
        ]}
        onPress={send}
        disabled={sending || rows.length === 0 || hasPreparing || overLimit}
      >
        {sending ? (
          <ActivityIndicator color={Colors.surface} />
        ) : (
          <>
            <Ionicons name="send" size={18} color={Colors.surface} />
            <Text style={styles.sendBtnText}>
              Send to {rows.length} recipient{rows.length !== 1 ? 's' : ''}
            </Text>
          </>
        )}
      </TouchableOpacity>

      {sendResult && (
        <View style={[styles.card, { borderColor: sendResult.failed.length > 0 ? Colors.error : '#10B981', borderWidth: 1 }]}>
          <Text style={styles.sectionTitle}>
            {sendResult.failed.length > 0 ? 'Done with errors' : 'Done'}
          </Text>
          <Text style={styles.infoText}>Sent: {sendResult.sent}</Text>
          {sendResult.failed.length > 0 && (
            <View style={{ gap: 4, marginTop: 4 }}>
              <Text style={styles.subLabel}>Failed ({sendResult.failed.length})</Text>
              {sendResult.failed.slice(0, 5).map((f) => (
                <Text key={f.email} style={styles.errorText} numberOfLines={2}>
                  {f.email}: {f.error}
                </Text>
              ))}
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    gap: 10,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  hint: { fontSize: 12, color: Colors.textSecondary, lineHeight: 18 },
  code: { fontFamily: 'monospace', fontSize: 11, color: Colors.copper },
  label: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary, marginTop: 4 },
  subLabel: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: Colors.text,
    backgroundColor: Colors.background,
  },
  bodyInput: { minHeight: 120 },
  fileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.copper,
    borderStyle: 'dashed',
    borderRadius: 10,
  },
  fileBtnText: { fontSize: 14, fontWeight: '600', color: Colors.copper },
  infoText: { fontSize: 12, color: Colors.textSecondary },
  errorText: { fontSize: 12, color: Colors.error },
  placeholderHint: { fontSize: 11, color: Colors.textMuted, fontStyle: 'italic' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    backgroundColor: Colors.background,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: Colors.border,
    maxWidth: 240,
  },
  fieldChip: { borderColor: Colors.copper, backgroundColor: Colors.copperTint },
  chipText: { fontSize: 11, color: Colors.text },
  moreText: { fontSize: 11, color: Colors.textMuted, alignSelf: 'center' },
  previewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  previewNav: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  previewNavBtn: {
    width: 28, height: 28, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  previewNavText: { fontSize: 12, color: Colors.textSecondary, fontWeight: '600', minWidth: 50, textAlign: 'center' },
  previewTo: { fontSize: 12, color: Colors.textMuted },
  previewSubject: { fontSize: 14, fontWeight: '700', color: Colors.text },
  previewBody: { fontSize: 13, color: Colors.text, lineHeight: 20 },
  attachChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: Colors.copperTint,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  attachChipName: { fontSize: 13, color: Colors.text, fontWeight: '500' },
  attachChipSize: { fontSize: 11, color: Colors.textMuted, marginTop: 1 },
  sendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 15,
    backgroundColor: Colors.copper,
    borderRadius: 12,
    minHeight: 50,
  },
  sendBtnText: { fontSize: 15, fontWeight: '700', color: Colors.surface },
});
