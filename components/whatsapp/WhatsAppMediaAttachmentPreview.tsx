import React from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';

export type AttachmentUploadStatus = 'uploading' | 'ready' | 'failed';

export type PendingAttachment = {
  id: string;
  localUri: string;
  name: string;
  mimeType: string;
  isImage: boolean;
  status: AttachmentUploadStatus;
  sizeBytes?: number | null;
  remoteUrl?: string;
  kind?: string;
  filename?: string;
  error?: string;
};

const MAX_ATTACHMENTS = 30;

type Props = {
  attachments: PendingAttachment[];
  caption: string;
  onCaptionChange: (text: string) => void;
  onRemove: (id: string) => void;
  onRemoveAll: () => void;
  onRetry: (id: string) => void;
  onAddMore: () => void;
};

function formatFileSize(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentTile({
  item,
  onRemove,
  onRetry,
}: {
  item: PendingAttachment;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const uploading = item.status === 'uploading';
  const failed = item.status === 'failed';

  if (item.isImage) {
    return (
      <View style={styles.tile}>
        <Image source={{ uri: item.localUri }} style={styles.tileImage} resizeMode="cover" />
        {uploading ? (
          <View style={styles.tileOverlay}>
            <ActivityIndicator size="small" color="#fff" />
          </View>
        ) : null}
        {failed ? (
          <TouchableOpacity style={styles.tileOverlay} onPress={onRetry}>
            <Ionicons name="refresh" size={22} color="#fff" />
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={styles.tileRemove} onPress={onRemove}>
          <Ionicons name="close-circle" size={22} color="#fff" />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.tile, styles.tileDoc]}>
      <Ionicons name="document-text" size={28} color="#075E54" />
      <Text style={styles.tileDocName} numberOfLines={2}>
        {item.name}
      </Text>
      {formatFileSize(item.sizeBytes) ? (
        <Text style={styles.tileDocSize}>{formatFileSize(item.sizeBytes)}</Text>
      ) : null}
      {uploading ? <ActivityIndicator size="small" color="#075E54" style={{ marginTop: 4 }} /> : null}
      {failed ? (
        <TouchableOpacity onPress={onRetry}>
          <Text style={styles.tileFail}>Retry</Text>
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity style={styles.tileRemove} onPress={onRemove}>
        <Ionicons name="close-circle" size={22} color={Colors.textMuted} />
      </TouchableOpacity>
    </View>
  );
}

export function WhatsAppMediaAttachmentPreview({
  attachments,
  caption,
  onCaptionChange,
  onRemove,
  onRemoveAll,
  onRetry,
  onAddMore,
}: Props) {
  const { width: screenWidth } = useWindowDimensions();
  const readyCount = attachments.filter((a) => a.status === 'ready').length;
  const uploadingCount = attachments.filter((a) => a.status === 'uploading').length;
  const singleImage =
    attachments.length === 1 && attachments[0].isImage ? attachments[0] : null;
  const heroHeight = Math.min(260, Math.round((screenWidth - 24) * 0.65));

  return (
    <View style={styles.wrap}>
      <View style={styles.toolbar}>
        <TouchableOpacity onPress={onRemoveAll} hitSlop={8}>
          <Ionicons name="close" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.toolbarTitle}>
          {attachments.length} {attachments.length === 1 ? 'item' : 'items'}
          {uploadingCount > 0 ? ` · ${uploadingCount} uploading` : ''}
          {readyCount > 0 && uploadingCount === 0 ? ' · ready' : ''}
        </Text>
        {attachments.length < MAX_ATTACHMENTS ? (
          <TouchableOpacity onPress={onAddMore} hitSlop={8} style={styles.addMoreBtn}>
            <Ionicons name="add" size={22} color="#075E54" />
            <Text style={styles.addMoreText}>Add</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {singleImage && singleImage.status !== 'failed' ? (
        <View style={[styles.heroFrame, { height: heroHeight }]}>
          <Image source={{ uri: singleImage.localUri }} style={styles.heroImage} resizeMode="cover" />
          {singleImage.status === 'uploading' ? (
            <View style={styles.heroOverlay}>
              <ActivityIndicator size="large" color="#fff" />
              <Text style={styles.heroOverlayText}>Uploading…</Text>
            </View>
          ) : null}
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.strip}
        >
          {attachments.map((item) => (
            <AttachmentTile
              key={item.id}
              item={item}
              onRemove={() => onRemove(item.id)}
              onRetry={() => onRetry(item.id)}
            />
          ))}
          {attachments.length < MAX_ATTACHMENTS ? (
            <TouchableOpacity style={styles.addTile} onPress={onAddMore}>
              <Ionicons name="add" size={32} color="#54656F" />
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      )}

      <View style={styles.captionRow}>
        <TextInput
          style={styles.captionInput}
          value={caption}
          onChangeText={onCaptionChange}
          placeholder={
            attachments.length > 1 ? 'Add a caption (sent with last item)' : 'Add a caption'
          }
          placeholderTextColor={Colors.textMuted}
          multiline
          maxLength={1024}
          editable={uploadingCount === 0 || readyCount > 0}
        />
      </View>
    </View>
  );
}

export const WHATSAPP_ATTACHMENT_PANEL_HEIGHT = 320;
export const WHATSAPP_MAX_ATTACHMENTS = MAX_ATTACHMENTS;

const TILE = 88;

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#EFEAE2',
    paddingTop: 6,
    paddingBottom: 6,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 10,
  },
  toolbarTitle: { flex: 1, fontSize: 14, fontWeight: '600', color: Colors.text },
  addMoreBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addMoreText: { fontSize: 14, fontWeight: '600', color: '#075E54' },
  heroFrame: {
    marginHorizontal: 12,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
  },
  heroImage: { width: '100%', height: '100%' },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  heroOverlayText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  strip: {
    paddingHorizontal: 12,
    gap: 8,
    paddingBottom: 4,
  },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
  },
  tileImage: { width: '100%', height: '100%' },
  tileOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileRemove: {
    position: 'absolute',
    top: 2,
    right: 2,
  },
  tileDoc: {
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 6,
  },
  tileDocName: { fontSize: 9, fontWeight: '600', color: Colors.text, textAlign: 'center' },
  tileDocSize: { fontSize: 8, color: Colors.textMuted },
  tileFail: { fontSize: 10, color: '#DC2626', marginTop: 2 },
  addTile: {
    width: TILE,
    height: TILE,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  captionRow: {
    paddingHorizontal: 8,
    marginTop: 8,
  },
  captionInput: {
    backgroundColor: Colors.surface,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    color: Colors.text,
    minHeight: 44,
    maxHeight: 100,
  },
});
