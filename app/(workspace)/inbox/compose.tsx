import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { gmailApi } from '../../../lib/api';
import { cacheDelete } from '../../../lib/cache';
import { sendMailDirectly, saveDraftDirectly, readFileAsBase64 } from '../../../lib/gmail-send-direct';
import { Colors } from '../../../constants/colors';

const GMAIL_LIMIT = 25 * 1024 * 1024; // 25 MB — hard Gmail cap

function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

function parseRecipients(raw: string): string[] {
  return raw.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
}

function formatBytes(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function currentToken(raw: string): string {
  const parts = raw.split(/[,;]/);
  return (parts[parts.length - 1] ?? '').trim().toLowerCase();
}

function replaceLastToken(raw: string, chosen: string): string {
  const parts = raw.split(/[,;]/);
  parts[parts.length - 1] = ' ' + chosen;
  return parts.join(', ').replace(/^,\s*/, '') + ', ';
}

interface Contact {
  email: string;
  displayName?: string;
}

// 'preparing' = reading file as base64 in background after pick
// 'saved'     = already stored in Gmail draft (loaded on re-open), no local data
type AttachmentStatus = 'preparing' | 'ready' | 'uploading' | 'drive' | 'saved' | 'error';

interface PickedFile {
  key: string;
  name: string;
  mimeType: string;
  size: number;
  uri: string;
  status: AttachmentStatus;
  base64Data?: string; // pre-read on pick so send is instant
  progress?: number;
  driveLink?: string;
  errorMsg?: string;
  // For attachments already saved in a Gmail draft
  attachmentId?: string;
  savedMessageId?: string;
}

type SuggestField = 'to' | 'cc' | 'bcc' | null;

let keySeq = 0;
function nextKey() { return String(++keySeq); }

export default function ComposeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ draftId?: string }>();
  const insets = useSafeAreaInsets();
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [sending, setSending] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [draftId, setDraftId] = useState<string | undefined>(params.draftId);
  const [attachments, setAttachments] = useState<PickedFile[]>([]);

  const [allContacts, setAllContacts] = useState<Contact[]>([]);
  const [suggestions, setSuggestions] = useState<Contact[]>([]);
  const [suggestField, setSuggestField] = useState<SuggestField>(null);

  // Load contacts
  useEffect(() => {
    gmailApi.getContacts()
      .then((r) => setAllContacts(r.contacts ?? []))
      .catch(() => {});
  }, []);

  // If opened from Drafts folder, fetch and pre-fill draft content
  useEffect(() => {
    if (!params.draftId) return;
    setLoadingDraft(true);
    gmailApi.getDraft(params.draftId)
      .then((d) => {
        if (d.to) setTo(d.to);
        if (d.cc) { setCc(d.cc); setShowCcBcc(true); }
        if (d.bcc) { setBcc(d.bcc); setShowCcBcc(true); }
        if (d.subject) setSubject(d.subject);
        if (d.textBody) setBody(d.textBody);
        setDraftId(d.draftId);
        if (d.attachments && d.attachments.length > 0) {
          setAttachments(d.attachments.map((a) => ({
            key: nextKey(),
            name: a.filename,
            mimeType: a.mimeType,
            size: a.size,
            uri: '',
            status: 'saved' as AttachmentStatus,
            attachmentId: a.attachmentId,
            savedMessageId: a.messageId,
          })));
        }
      })
      .catch((e) => Alert.alert('Could not load draft', e?.message ?? 'Something went wrong.'))
      .finally(() => setLoadingDraft(false));
  }, [params.draftId]);

  function computeSuggestions(raw: string, field: SuggestField) {
    const token = currentToken(raw);
    if (token.length < 2 || allContacts.length === 0) {
      setSuggestions([]);
      setSuggestField(null);
      return;
    }
    const matches = allContacts.filter(
      (c) =>
        c.email.toLowerCase().includes(token) ||
        (c.displayName ?? '').toLowerCase().includes(token)
    ).slice(0, 6);
    setSuggestions(matches);
    setSuggestField(matches.length > 0 ? field : null);
  }

  function onChangeField(value: string, field: SuggestField, setter: (v: string) => void) {
    setter(value);
    computeSuggestions(value, field);
  }

  function pickSuggestion(contact: Contact, field: SuggestField) {
    const label = contact.displayName
      ? `${contact.displayName} <${contact.email}>`
      : contact.email;
    if (field === 'to') setTo((v) => replaceLastToken(v, label));
    else if (field === 'cc') setCc((v) => replaceLastToken(v, label));
    else if (field === 'bcc') setBcc((v) => replaceLastToken(v, label));
    setSuggestions([]);
    setSuggestField(null);
  }

  async function uploadToDrive(file: PickedFile) {
    const key = file.key;
    const setStatus = (patch: Partial<PickedFile>) =>
      setAttachments((prev) => prev.map((f) => f.key === key ? { ...f, ...patch } : f));

    setStatus({ status: 'uploading', progress: 0 });
    try {
      // Fetch the Google access token from our backend
      const { accessToken } = await gmailApi.getGoogleToken();

      // Step 1: start a resumable upload session
      const meta = JSON.stringify({ name: file.name });
      const initRes = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Type': file.mimeType,
            'X-Upload-Content-Length': String(file.size),
          },
          body: meta,
        }
      );
      if (!initRes.ok) {
        const txt = await initRes.text();
        throw new Error(`Drive session init failed (${initRes.status}): ${txt}`);
      }
      const sessionUrl = initRes.headers.get('Location');
      if (!sessionUrl) throw new Error('Drive upload: missing session URL');

      // Step 2: upload the file bytes via XHR so we get progress events
      const fileId = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', sessionUrl);
        xhr.setRequestHeader('Content-Type', file.mimeType);

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setStatus({ progress: Math.round((e.loaded / e.total) * 100) });
          }
        };

        xhr.onload = () => {
          if (xhr.status === 200 || xhr.status === 201) {
            try {
              const data = JSON.parse(xhr.responseText);
              resolve(data.id);
            } catch {
              reject(new Error('Drive upload: invalid response'));
            }
          } else {
            reject(new Error(`Drive upload failed (${xhr.status}): ${xhr.responseText}`));
          }
        };

        xhr.onerror = () => reject(new Error('Drive upload: network error'));

        // Send the local file URI directly — React Native's XHR handles file:// URIs
        xhr.send({ uri: file.uri, type: file.mimeType, name: file.name } as any);
      });

      // Make the file accessible to anyone with the link (reader)
      await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'anyone', role: 'reader' }),
      });

      const driveLink = `https://drive.google.com/file/d/${fileId}/view`;
      setStatus({ status: 'drive', progress: 100, driveLink });
    } catch (e: any) {
      setStatus({ status: 'error', errorMsg: e?.message ?? 'Upload failed' });
      Alert.alert('Drive upload failed', e?.message ?? 'Could not upload to Google Drive.');
    }
  }

  async function pickAttachment() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (result.canceled) return;

      for (const a of result.assets) {
        const size = a.size ?? 0;
        const file: PickedFile = {
          key: nextKey(),
          name: a.name,
          mimeType: a.mimeType ?? 'application/octet-stream',
          size,
          uri: a.uri,
          status: 'ready',
        };

        if (size > GMAIL_LIMIT) {
          const captured = file;
          Alert.alert(
            'File too large to attach',
            `"${file.name}" (${formatBytes(size)}) exceeds Gmail's 25 MB limit.\n\nUpload it to Google Drive and insert a link instead?`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Insert Drive link',
                onPress: () => {
                  setAttachments((prev) => [...prev, { ...captured, status: 'uploading', progress: 0 }]);
                  uploadToDrive(captured);
                },
              },
            ]
          );
        } else {
          // Add immediately as 'preparing', read base64 in background so send is instant
          const key = file.key;
          setAttachments((prev) => [...prev, { ...file, status: 'preparing' }]);
          readFileAsBase64(file.uri)
            .then((base64Data) => {
              setAttachments((prev) =>
                prev.map((f) => f.key === key ? { ...f, status: 'ready', base64Data } : f)
              );
            })
            .catch(() => {
              setAttachments((prev) =>
                prev.map((f) => f.key === key ? { ...f, status: 'error', errorMsg: 'Failed to read file' } : f)
              );
            });
        }
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to pick file');
    }
  }

  function removeAttachment(key: string) {
    setAttachments((prev) => prev.filter((f) => f.key !== key));
  }

  async function handleSend() {
    const preparing = attachments.find((f) => f.status === 'preparing');
    if (preparing) {
      Alert.alert('Please wait', `"${preparing.name}" is still being prepared.`);
      return;
    }
    const uploading = attachments.find((f) => f.status === 'uploading');
    if (uploading) {
      Alert.alert('Please wait', 'A file is still uploading to Google Drive.');
      return;
    }
    const failed = attachments.find((f) => f.status === 'error');
    if (failed) {
      Alert.alert('Upload error', `"${failed.name}" failed. Remove it or try again before sending.`);
      return;
    }

    const toList = parseRecipients(to);
    if (toList.length === 0) {
      Alert.alert('Missing recipient', 'Enter at least one email address in "To".');
      return;
    }
    const invalid = toList.find((e) => !isValidEmail(e));
    if (invalid) {
      Alert.alert('Invalid email', `"${invalid}" is not a valid email address.`);
      return;
    }
    const ccList = parseRecipients(cc);
    const ccInvalid = ccList.find((e) => !isValidEmail(e));
    if (ccInvalid) {
      Alert.alert('Invalid email', `Cc "${ccInvalid}" is not valid.`);
      return;
    }
    const bccList = parseRecipients(bcc);
    const bccInvalid = bccList.find((e) => !isValidEmail(e));
    if (bccInvalid) {
      Alert.alert('Invalid email', `Bcc "${bccInvalid}" is not valid.`);
      return;
    }

    setSending(true);
    try {
      // Append Drive links to body text
      const driveLinks = attachments.filter((f) => f.status === 'drive' && f.driveLink);
      let finalBody = body;
      if (driveLinks.length > 0) {
        const linkBlock = driveLinks.map((f) => `${f.name}: ${f.driveLink}`).join('\n');
        finalBody = finalBody
          ? `${finalBody}\n\n--- Attachments ---\n${linkBlock}`
          : linkBlock;
      }

      const inlineAttachments = attachments.filter((f) => f.status === 'ready' || f.status === 'saved');

      if (inlineAttachments.length > 0) {
        // Send directly to Gmail API — bypasses Next.js body size limit entirely
        const { accessToken } = await gmailApi.getGoogleToken();
        // Resolve 'saved' attachments by fetching bytes from Gmail via attachment proxy
        const resolvedAttachments = await Promise.all(
          inlineAttachments.map(async (f) => {
            if (f.status === 'saved' && f.attachmentId && f.savedMessageId) {
              const url = gmailApi.attachmentUrl(f.savedMessageId, f.attachmentId, f.name, f.mimeType);
              const base64Data = await readFileAsBase64(url);
              return { filename: f.name, mimeType: f.mimeType, uri: '', base64Data };
            }
            return { filename: f.name, mimeType: f.mimeType, uri: f.uri, base64Data: f.base64Data };
          })
        );
        await sendMailDirectly({
          accessToken,
          to: toList.join(', '),
          cc: ccList.length > 0 ? ccList.join(', ') : undefined,
          bcc: bccList.length > 0 ? bccList.join(', ') : undefined,
          subject: subject.trim(),
          textBody: finalBody,
          attachments: resolvedAttachments,
        });
      } else {
        // No inline attachments — plain JSON through backend
        await gmailApi.send({
          to: toList.join(', '),
          cc: ccList.length > 0 ? ccList.join(', ') : undefined,
          bcc: bccList.length > 0 ? bccList.join(', ') : undefined,
          subject: subject.trim(),
          textBody: finalBody,
        });
      }

      Alert.alert('Sent', 'Your email was sent.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e: any) {
      console.error('[compose] send failed:', e?.message);
      Alert.alert('Failed to send', e?.message ?? 'Something went wrong.');
    } finally {
      setSending(false);
    }
  }

  async function saveDraft() {
    const driveLinks = attachments.filter((f) => f.status === 'drive' && f.driveLink);
    let draftBody = body;
    if (driveLinks.length > 0) {
      const linkBlock = driveLinks.map((f) => `${f.name}: ${f.driveLink}`).join('\n');
      draftBody = draftBody ? `${draftBody}\n\n--- Attachments ---\n${linkBlock}` : linkBlock;
    }

    setSavingDraft(true);
    try {
      // Save directly to Gmail API so attachments are preserved (bypasses backend body limit)
      const { accessToken } = await gmailApi.getGoogleToken();

      // Resolve 'saved' attachments: re-fetch bytes from Gmail via attachment proxy
      const allAttachments = await Promise.all(
        attachments
          .filter((f) => f.status === 'ready' || f.status === 'saved')
          .map(async (f): Promise<{ filename: string; mimeType: string; uri: string; base64Data?: string }> => {
            if (f.status === 'saved' && f.attachmentId && f.savedMessageId) {
              const url = gmailApi.attachmentUrl(f.savedMessageId, f.attachmentId, f.name, f.mimeType);
              const base64Data = await readFileAsBase64(url);
              return { filename: f.name, mimeType: f.mimeType, uri: '', base64Data };
            }
            return { filename: f.name, mimeType: f.mimeType, uri: f.uri, base64Data: f.base64Data };
          })
      );

      const res = await saveDraftDirectly({
        accessToken,
        to: to.trim() || undefined,
        cc: cc.trim() || undefined,
        bcc: bcc.trim() || undefined,
        subject: subject.trim(),
        textBody: draftBody,
        draftId,
        attachments: allAttachments,
      });
      setDraftId(res.draftId);
      cacheDelete('inbox:drafts:');
      return true;
    } catch (e: any) {
      Alert.alert('Could not save draft', e?.message ?? 'Something went wrong.');
      return false;
    } finally {
      setSavingDraft(false);
    }
  }

  async function handleSaveDraftAndClose() {
    const ok = await saveDraft();
    if (ok) router.back();
  }

  async function discardAndClose() {
    if (draftId) {
      try { await gmailApi.deleteDraft(draftId); } catch { /* non-fatal */ }
      // Bust the drafts cache so the inbox doesn't re-show the deleted draft
      cacheDelete('inbox:drafts:');
    }
    router.back();
  }

  function handleDiscard() {
    const hasContent = to || subject || body || cc || bcc || attachments.length > 0;
    if (!hasContent && !draftId) { router.back(); return; }
    Alert.alert(
      'Close',
      draftId ? 'Save changes to draft or discard?' : 'Save this message as a draft or discard it?',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Save as draft', onPress: handleSaveDraftAndClose },
        { text: 'Discard', style: 'destructive', onPress: discardAndClose },
      ]
    );
  }

  const hasUploading = attachments.some((f) => f.status === 'uploading' || f.status === 'preparing');

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: Colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleDiscard} disabled={savingDraft || sending || loadingDraft} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={26} color={savingDraft || sending || loadingDraft ? Colors.textMuted : Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{draftId && !loadingDraft ? 'Edit Draft' : 'New Message'}</Text>
          <TouchableOpacity
            onPress={handleSend}
            disabled={sending || hasUploading}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {sending
              ? <ActivityIndicator color={Colors.primary} size="small" />
              : <Ionicons name="send" size={22} color={hasUploading ? Colors.textMuted : Colors.primary} />
            }
          </TouchableOpacity>
        </View>

        {loadingDraft && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.loadingText}>Loading draft…</Text>
          </View>
        )}

        <ScrollView
          style={styles.form}
          contentContainerStyle={{ paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>To</Text>
            <TextInput
              style={styles.fieldInput}
              value={to}
              onChangeText={(v) => onChangeField(v, 'to', setTo)}
              onFocus={() => computeSuggestions(to, 'to')}
              onBlur={() => setTimeout(() => { setSuggestions([]); setSuggestField(null); }, 150)}
              placeholder="recipient@example.com"
              placeholderTextColor={Colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity onPress={() => setShowCcBcc((v) => !v)}>
              <Text style={styles.ccBccToggle}>{showCcBcc ? 'Hide' : 'Cc/Bcc'}</Text>
            </TouchableOpacity>
          </View>

          {suggestField === 'to' && suggestions.length > 0 && (
            <SuggestionList suggestions={suggestions} onPick={(c) => pickSuggestion(c, 'to')} />
          )}

          {showCcBcc && (
            <>
              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>Cc</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={cc}
                  onChangeText={(v) => onChangeField(v, 'cc', setCc)}
                  onFocus={() => computeSuggestions(cc, 'cc')}
                  onBlur={() => setTimeout(() => { setSuggestions([]); setSuggestField(null); }, 150)}
                  placeholder="cc@example.com"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              {suggestField === 'cc' && suggestions.length > 0 && (
                <SuggestionList suggestions={suggestions} onPick={(c) => pickSuggestion(c, 'cc')} />
              )}

              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>Bcc</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={bcc}
                  onChangeText={(v) => onChangeField(v, 'bcc', setBcc)}
                  onFocus={() => computeSuggestions(bcc, 'bcc')}
                  onBlur={() => setTimeout(() => { setSuggestions([]); setSuggestField(null); }, 150)}
                  placeholder="bcc@example.com"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              {suggestField === 'bcc' && suggestions.length > 0 && (
                <SuggestionList suggestions={suggestions} onPick={(c) => pickSuggestion(c, 'bcc')} />
              )}
            </>
          )}

          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Subject</Text>
            <TextInput
              style={styles.fieldInput}
              value={subject}
              onChangeText={setSubject}
              placeholder="Subject"
              placeholderTextColor={Colors.textMuted}
            />
          </View>

          <TextInput
            style={styles.bodyInput}
            value={body}
            onChangeText={setBody}
            placeholder="Compose email..."
            placeholderTextColor={Colors.textMuted}
            multiline
            textAlignVertical="top"
          />

          {attachments.length > 0 && (
            <View style={styles.attachmentList}>
              {attachments.map((f) => (
                <AttachmentChip key={f.key} file={f} onRemove={() => removeAttachment(f.key)} />
              ))}
            </View>
          )}
        </ScrollView>

        <View style={[styles.toolbar, { paddingBottom: insets.bottom + 8 }]}>
          <TouchableOpacity
            style={styles.toolbarBtn}
            onPress={pickAttachment}
            disabled={savingDraft}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="attach" size={22} color={Colors.textSecondary} />
            <Text style={styles.toolbarBtnText}>Attach</Text>
            {attachments.length > 0 && (
              <View style={styles.attachBadge}>
                <Text style={styles.attachBadgeText}>{attachments.length}</Text>
              </View>
            )}
          </TouchableOpacity>
          {savingDraft && (
            <ActivityIndicator size="small" color={Colors.primary} style={{ marginRight: 8 }} />
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function AttachmentChip({ file, onRemove }: { file: PickedFile; onRemove: () => void }) {
  const isPreparing = file.status === 'preparing';
  const isDrive = file.status === 'drive';
  const isUploading = file.status === 'uploading';
  const isSaved = file.status === 'saved';
  const isBusy = isPreparing || isUploading;
  const isError = file.status === 'error';
  const progress = file.progress ?? 0;

  const chipColor = isError ? Colors.error : isDrive ? '#0F9D58' : Colors.primary;
  const bgColor = isError ? '#FEE2E2' : isDrive ? '#E6F4EA' : Colors.primaryLight;

  return (
    <View style={[styles.attachmentChip, { backgroundColor: bgColor, borderColor: chipColor + '44' }]}>
      {isBusy ? (
        <ActivityIndicator size="small" color={Colors.primary} style={{ width: 14, height: 14 }} />
      ) : isDrive ? (
        <Ionicons name="logo-google" size={14} color={chipColor} />
      ) : isError ? (
        <Ionicons name="warning-outline" size={14} color={chipColor} />
      ) : (
        <Ionicons name="document-outline" size={14} color={chipColor} />
      )}

      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text style={[styles.attachmentName, { color: chipColor }]} numberOfLines={1}>
          {file.name}
        </Text>
        {isPreparing && (
          <Text style={[styles.attachmentStatus, { color: Colors.textMuted }]}>Preparing…</Text>
        )}
        {isUploading && (
          <>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progress}%` as any }]} />
            </View>
            <Text style={[styles.attachmentStatus, { color: Colors.textMuted }]}>
              Uploading to Drive… {progress}%
            </Text>
          </>
        )}
        {isDrive && (
          <Text style={[styles.attachmentStatus, { color: chipColor }]}>Saved to Drive · link in email</Text>
        )}
        {isSaved && (
          <Text style={[styles.attachmentStatus, { color: Colors.textMuted }]}>In draft{file.size > 0 ? ` · ${formatBytes(file.size)}` : ''}</Text>
        )}
        {isError && (
          <Text style={[styles.attachmentStatus, { color: chipColor }]} numberOfLines={2}>
            {file.errorMsg ?? 'Upload failed'}
          </Text>
        )}
        {file.status === 'ready' && file.size > 0 && (
          <Text style={[styles.attachmentStatus, { color: Colors.textMuted }]}>{formatBytes(file.size)}</Text>
        )}
      </View>

      {!isBusy && (
        <TouchableOpacity onPress={onRemove} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
        </TouchableOpacity>
      )}
    </View>
  );
}

function SuggestionList({ suggestions, onPick }: { suggestions: Contact[]; onPick: (c: Contact) => void }) {
  return (
    <View style={styles.suggestionBox}>
      {suggestions.map((c) => (
        <TouchableOpacity
          key={c.email}
          style={styles.suggestionRow}
          onPress={() => onPick(c)}
          activeOpacity={0.7}
        >
          <View style={styles.suggestionAvatar}>
            <Text style={styles.suggestionAvatarText}>
              {((c.displayName ?? c.email).charAt(0) || '?').toUpperCase()}
            </Text>
          </View>
          <View style={styles.suggestionText}>
            {c.displayName ? (
              <>
                <Text style={styles.suggestionName} numberOfLines={1}>{c.displayName}</Text>
                <Text style={styles.suggestionEmail} numberOfLines={1}>{c.email}</Text>
              </>
            ) : (
              <Text style={styles.suggestionName} numberOfLines={1}>{c.email}</Text>
            )}
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.text },
  form: { flex: 1 },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    gap: 10,
  },
  fieldLabel: {
    width: 56,
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  fieldInput: {
    flex: 1,
    fontSize: 14,
    color: Colors.text,
    padding: 0,
  },
  ccBccToggle: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.primary,
  },
  suggestionBox: {
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 4,
    elevation: 4,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderLight,
  },
  suggestionAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionAvatarText: { fontSize: 13, fontWeight: '700', color: Colors.primary },
  suggestionText: { flex: 1 },
  suggestionName: { fontSize: 13, fontWeight: '600', color: Colors.text },
  suggestionEmail: { fontSize: 12, color: Colors.textMuted },
  bodyInput: {
    minHeight: 200,
    padding: 16,
    fontSize: 15,
    color: Colors.text,
    lineHeight: 22,
  },
  attachmentList: {
    flexDirection: 'column',
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  attachmentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  attachmentName: {
    fontSize: 13,
    fontWeight: '500',
  },
  attachmentStatus: {
    fontSize: 11,
  },
  progressTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: Colors.border,
    overflow: 'hidden',
  },
  progressFill: {
    height: 3,
    borderRadius: 2,
    backgroundColor: Colors.primary,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.surface,
    gap: 16,
  },
  toolbarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  toolbarBtnText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  attachBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.surface,
  },
  loadingOverlay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 20,
  },
  loadingText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
});
