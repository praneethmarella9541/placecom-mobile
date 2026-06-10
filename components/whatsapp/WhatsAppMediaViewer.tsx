import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  StatusBar,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import WebView from 'react-native-webview';
import type { WhatsAppMessage } from '../../lib/whatsapp-types';
import {
  downloadUrlToCacheFile,
  readCacheFileBase64,
} from '../../lib/file-cache-download';
import { buildAttachmentPreviewContent } from '../../lib/attachment-preview';
import { shareCachedAttachment } from '../../lib/share-attachment';
import {
  isOwnApiMedia,
  resolveWhatsAppMediaUrl,
  whatsAppMediaSource,
} from '../../lib/whatsapp-media';
import {
  categorizeWhatsAppMedia,
  isPdfMessage,
  mediaFilenameFromMessage,
  mimeTypeFromMessage,
} from '../../lib/whatsapp-media-helpers';
import {
  wrapPdfPreviewFetchHtml,
  wrapPdfPreviewHtml,
  wrapVideoPreviewHtml,
} from '../../lib/preview-html';
import { isImageMessage } from '../../lib/whatsapp-message-display';

type Props = {
  message: WhatsAppMessage | null;
  authToken?: string | null;
  onClose: () => void;
};

type ViewerPhase = 'loading' | 'ready' | 'error';

export function WhatsAppMediaViewer({ message, authToken, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<ViewerPhase>('loading');
  const [error, setError] = useState('');
  const [sharing, setSharing] = useState(false);
  const [filename, setFilename] = useState('');
  const [mimeType, setMimeType] = useState('application/octet-stream');
  const [shareUri, setShareUri] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [imageSource, setImageSource] = useState<{ uri: string; headers?: Record<string, string> } | null>(null);

  const visible = !!message;

  const loadMedia = useCallback(async () => {
    if (!message?.media_url) return;
    const resolved = resolveWhatsAppMediaUrl(message.media_url);
    if (!resolved) {
      setPhase('error');
      setError('Media URL is missing.');
      return;
    }

    const name = mediaFilenameFromMessage(message);
    const mime = mimeTypeFromMessage(message);
    setFilename(name);
    setMimeType(mime);
    setPhase('loading');
    setError('');
    setPreviewHtml(null);
    setImageSource(null);
    setShareUri(null);

    const headers =
      authToken && isOwnApiMedia(resolved)
        ? { Authorization: `Bearer ${authToken}` }
        : undefined;

    try {
      const category = categorizeWhatsAppMedia(message);
      const isImage = isImageMessage(message);
      const isPdf = isPdfMessage(message);

      if (isImage && !isPdf) {
        const source = whatsAppMediaSource(resolved, authToken);
        setImageSource(source);
        const cached = await downloadUrlToCacheFile(resolved, 'whatsapp_media', name, headers);
        setShareUri(cached.uri);
        setPhase('ready');
        return;
      }

      if (isPdf) {
        setPreviewHtml(wrapPdfPreviewFetchHtml(resolved, authToken));
        const cached = await downloadUrlToCacheFile(resolved, 'whatsapp_media', name, headers);
        setShareUri(cached.uri);
        setPhase('ready');
        return;
      }

      if (category === 'video') {
        setPreviewHtml(wrapVideoPreviewHtml(resolved, authToken));
        const cached = await downloadUrlToCacheFile(resolved, 'whatsapp_media', name, headers);
        setShareUri(cached.uri);
        setPhase('ready');
        return;
      }

      const cached = await downloadUrlToCacheFile(resolved, 'whatsapp_media', name, headers);
      setShareUri(cached.uri);
      const content = await buildAttachmentPreviewContent(cached.uri, name, mime);
      if (content.type === 'html') {
        setPreviewHtml(content.html);
      } else if (content.type === 'data-uri') {
        setPreviewHtml(
          `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body style="margin:0;background:#111;display:flex;align-items:center;justify-content:center;min-height:100vh;"><img src="${content.uri}" style="max-width:100%;max-height:100vh;object-fit:contain;" /></body></html>`
        );
      } else {
        const base64 = await readCacheFileBase64(cached.uri);
        if (name.toLowerCase().endsWith('.pdf')) {
          setPreviewHtml(wrapPdfPreviewHtml(base64));
        }
      }
      setPhase('ready');
    } catch (e: unknown) {
      setPhase('error');
      setError(e instanceof Error ? e.message : 'Could not open media');
    }
  }, [authToken, message]);

  useEffect(() => {
    if (message) void loadMedia();
    else {
      setPhase('loading');
      setPreviewHtml(null);
      setImageSource(null);
      setShareUri(null);
    }
  }, [message, loadMedia]);

  async function handleDownload() {
    if (!shareUri) return;
    setSharing(true);
    try {
      await shareCachedAttachment(shareUri, filename, mimeType);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setSharing(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <StatusBar barStyle="light-content" />
      <View style={[styles.root, { paddingBottom: insets.bottom }]}>
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={26} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title} numberOfLines={1}>
            {filename || 'Media'}
          </Text>
          <TouchableOpacity
            onPress={() => void handleDownload()}
            disabled={!shareUri || sharing || phase !== 'ready'}
            hitSlop={8}
          >
            {sharing ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons
                name="download-outline"
                size={24}
                color={shareUri && phase === 'ready' ? '#fff' : '#666'}
              />
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.body}>
          {phase === 'loading' ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color="#25D366" />
              <Text style={styles.loadingText}>Loading…</Text>
            </View>
          ) : null}

          {phase === 'error' ? (
            <View style={styles.center}>
              <Ionicons name="alert-circle-outline" size={56} color="#888" />
              <Text style={styles.errorTitle}>Could not open file</Text>
              <Text style={styles.errorSub}>{error}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={() => void loadMedia()}>
                <Text style={styles.retryText}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {phase === 'ready' && imageSource ? (
            <Image source={imageSource} style={styles.image} resizeMode="contain" />
          ) : null}

          {phase === 'ready' && previewHtml ? (
            <WebView
              source={{ html: previewHtml }}
              style={styles.web}
              originWhitelist={['*']}
              nestedScrollEnabled
              scrollEnabled
              startInLoadingState
              renderLoading={() => (
                <View style={styles.webLoading}>
                  <ActivityIndicator color="#25D366" />
                </View>
              )}
            />
          ) : null}

          {phase === 'ready' && !imageSource && !previewHtml ? (
            <View style={styles.center}>
              <Ionicons name="document-outline" size={64} color="#888" />
              <Text style={styles.errorSub}>Preview not available.</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={() => void handleDownload()}>
                <Text style={styles.retryText}>Download / Share</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#111',
    zIndex: 2,
  },
  title: { flex: 1, marginHorizontal: 12, fontSize: 15, fontWeight: '600', color: '#fff' },
  body: { flex: 1, minHeight: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },
  loadingText: { color: '#ccc', fontSize: 14 },
  errorTitle: { color: '#fff', fontSize: 17, fontWeight: '600' },
  errorSub: { color: '#aaa', fontSize: 14, textAlign: 'center' },
  retryBtn: {
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#25D366',
  },
  retryText: { color: '#fff', fontWeight: '600' },
  image: { flex: 1, width: '100%' },
  web: { flex: 1, backgroundColor: '#525659' },
  webLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#525659',
  },
});
