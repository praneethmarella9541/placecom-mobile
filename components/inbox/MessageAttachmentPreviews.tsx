import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { GmailAttachment } from '../../lib/api';
import { Gmail } from '../../constants/gmailTheme';
import {
  fetchAttachmentImageDataUri,
  peekAttachmentImageDataUri,
  getAttachmentVisual,
  formatAttachmentBytes,
  truncateFilename,
  type AttachmentKind,
} from '../../lib/gmail-attachments';

type Props = {
  messageId: string;
  attachments: GmailAttachment[];
  onPreview: (att: GmailAttachment) => void;
  onDownload: (att: GmailAttachment) => void;
  busyAttachmentId?: string | null;
  /** When above the body, use bottom margin instead of top. */
  placement?: 'above' | 'below';
};

function AttachmentPreviewCard({
  messageId,
  att,
  cardWidth,
  onPreview,
  onDownload,
  busy,
}: {
  messageId: string;
  att: GmailAttachment;
  cardWidth: number;
  onPreview: (att: GmailAttachment) => void;
  onDownload: (att: GmailAttachment) => void;
  busy?: boolean;
}) {
  const visual = getAttachmentVisual(att.mimeType, att.filename);
  const isImage = visual.kind === 'image';
  const [dataUri, setDataUri] = useState<string | null>(
    () => peekAttachmentImageDataUri(messageId, att.attachmentId) ?? null
  );
  const [loading, setLoading] = useState(isImage && !dataUri);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!isImage) return;
    if (dataUri) return;

    setLoading(true);
    setFailed(false);
    fetchAttachmentImageDataUri(messageId, att.attachmentId, att.filename, att.mimeType)
      .then((uri) => {
        if (!cancelled) setDataUri(uri);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [messageId, att.attachmentId, att.filename, att.mimeType, isImage, dataUri]);

  function onPressPreview() {
    if (busy) return;
    onPreview(att);
  }

  function onPressDownload() {
    if (busy) return;
    onDownload(att);
  }

  if (isImage) {
    return (
      <View style={[styles.imageCard, { width: cardWidth }]}>
        <TouchableOpacity
          onPress={onPressPreview}
          disabled={busy}
          activeOpacity={0.85}
        >
          {busy ? (
            <View style={styles.imagePlaceholder}>
              <ActivityIndicator color={Gmail.blue} />
              <Text style={styles.busyText}>Opening…</Text>
            </View>
          ) : loading ? (
            <View style={styles.imagePlaceholder}>
              <ActivityIndicator color={Gmail.blue} />
            </View>
          ) : failed || !dataUri ? (
            <View style={[styles.imagePlaceholder, { backgroundColor: visual.bg }]}>
              <Ionicons
                name={visual.icon as keyof typeof Ionicons.glyphMap}
                size={36}
                color={visual.color}
              />
              <Text style={styles.fallbackName} numberOfLines={2}>
                {truncateFilename(att.filename, 28)}
              </Text>
            </View>
          ) : (
            <Image source={{ uri: dataUri }} style={styles.imagePreview} resizeMode="cover" />
          )}
        </TouchableOpacity>
        <View style={styles.imageCaption}>
          <TouchableOpacity style={styles.imageCaptionMain} onPress={onPressPreview} disabled={busy}>
            <Text style={styles.imageCaptionText} numberOfLines={1}>
              {truncateFilename(att.filename, 32)}
            </Text>
            {att.size > 0 ? (
              <Text style={styles.imageCaptionMeta}>{formatAttachmentBytes(att.size)}</Text>
            ) : null}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onPressDownload}
            disabled={busy}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Download attachment"
          >
            <Ionicons name="download-outline" size={22} color={Gmail.blue} />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <FileTypeChip
      att={att}
      visual={visual}
      onPreview={onPressPreview}
      onDownload={onPressDownload}
      busy={busy}
    />
  );
}

function FileTypeChip({
  att,
  visual,
  onPreview,
  onDownload,
  busy,
}: {
  att: GmailAttachment;
  visual: ReturnType<typeof getAttachmentVisual>;
  onPreview: () => void;
  onDownload: () => void;
  busy?: boolean;
}) {
  return (
    <View style={[styles.fileChip, { borderColor: visual.color + '33' }, busy && styles.fileChipBusy]}>
      <TouchableOpacity
        style={styles.fileChipMain}
        onPress={onPreview}
        disabled={busy}
        activeOpacity={0.75}
      >
        {busy ? (
          <ActivityIndicator size="small" color={Gmail.blue} style={{ width: 40, height: 40 }} />
        ) : (
          <View style={[styles.fileIconWrap, { backgroundColor: visual.bg }]}>
            <Ionicons
              name={visual.icon as keyof typeof Ionicons.glyphMap}
              size={22}
              color={visual.color}
            />
          </View>
        )}
        <View style={styles.fileText}>
          <Text style={styles.fileName} numberOfLines={1}>
            {truncateFilename(att.filename, 26)}
          </Text>
          {busy ? (
            <Text style={styles.fileMeta}>Please wait…</Text>
          ) : att.size > 0 ? (
            <Text style={styles.fileMeta}>{formatAttachmentBytes(att.size)}</Text>
          ) : (
            <Text style={styles.fileMeta}>{kindLabel(visual.kind)}</Text>
          )}
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onDownload}
        disabled={busy}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={styles.fileDownloadBtn}
        accessibilityLabel="Download attachment"
      >
        <Ionicons name="download-outline" size={22} color={busy ? Gmail.textMuted : Gmail.blue} />
      </TouchableOpacity>
    </View>
  );
}

function kindLabel(kind: AttachmentKind): string {
  switch (kind) {
    case 'pdf':
      return 'PDF';
    case 'word':
      return 'Document';
    case 'excel':
      return 'Spreadsheet';
    case 'powerpoint':
      return 'Presentation';
    case 'video':
      return 'Video';
    case 'audio':
      return 'Audio';
    case 'archive':
      return 'Archive';
    default:
      return 'Attachment';
  }
}

export function MessageAttachmentPreviews({
  messageId,
  attachments,
  onPreview,
  onDownload,
  busyAttachmentId,
  placement = 'below',
}: Props) {
  const { width } = useWindowDimensions();
  const imageWidth = Math.min(width - 48, 320);
  const images = attachments.filter((a) => getAttachmentVisual(a.mimeType, a.filename).kind === 'image');
  const files = attachments.filter((a) => getAttachmentVisual(a.mimeType, a.filename).kind !== 'image');

  if (attachments.length === 0) return null;

  return (
    <View style={[styles.wrap, placement === 'above' ? styles.wrapAbove : styles.wrapBelow]}>
      {images.length > 0 ? (
        <View style={styles.imageRow}>
          {images.map((att) => (
            <AttachmentPreviewCard
              key={att.attachmentId}
              messageId={messageId}
              att={att}
              cardWidth={images.length === 1 ? imageWidth : Math.min(imageWidth, 200)}
              onPreview={onPreview}
              onDownload={onDownload}
              busy={busyAttachmentId === att.attachmentId}
            />
          ))}
        </View>
      ) : null}
      {files.length > 0 ? (
        <View style={styles.fileRow}>
          {files.map((att) => (
            <AttachmentPreviewCard
              key={att.attachmentId}
              messageId={messageId}
              att={att}
              cardWidth={0}
              onPreview={onPreview}
              onDownload={onDownload}
              busy={busyAttachmentId === att.attachmentId}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 10,
  },
  wrapAbove: {
    marginTop: 0,
    marginBottom: 12,
  },
  wrapBelow: {
    marginTop: 12,
    marginBottom: 0,
  },
  imageRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  imageCard: {
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Gmail.border,
    backgroundColor: Gmail.bgMuted,
  },
  imagePreview: {
    width: '100%',
    height: 152,
    backgroundColor: Gmail.divider,
  },
  imagePlaceholder: {
    width: '100%',
    height: 152,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  busyText: { fontSize: 13, color: Gmail.textSecondary },
  fallbackName: {
    fontSize: 12,
    color: Gmail.textSecondary,
    textAlign: 'center',
  },
  imageCaption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: Gmail.bg,
  },
  imageCaptionMain: { flex: 1, minWidth: 0 },
  imageCaptionText: {
    fontSize: 13,
    fontWeight: '500',
    color: Gmail.text,
  },
  imageCaptionMeta: {
    fontSize: 11,
    color: Gmail.textMuted,
  },
  fileRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  fileChip: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '100%',
    minWidth: 200,
    flexGrow: 1,
    flexBasis: '48%',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Gmail.border,
    backgroundColor: Gmail.bg,
    overflow: 'hidden',
  },
  fileChipBusy: {
    opacity: 0.85,
  },
  fileChipMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 4,
    minWidth: 0,
  },
  fileDownloadBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignSelf: 'stretch',
    justifyContent: 'center',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: Gmail.divider,
  },
  fileIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  fileName: {
    fontSize: 14,
    fontWeight: '500',
    color: Gmail.text,
  },
  fileMeta: {
    fontSize: 12,
    color: Gmail.textSecondary,
  },
});
