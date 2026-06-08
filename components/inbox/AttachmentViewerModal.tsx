import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import WebView from 'react-native-webview';
import { Colors } from '../../constants/colors';
import { Gmail } from '../../constants/gmailTheme';
import type { AttachmentPreviewContent } from '../../lib/attachment-preview';

export type AttachmentViewerState =
  | {
      phase: 'loading';
      filename: string;
      statusText?: string;
    }
  | {
      phase: 'ready';
      filename: string;
      mimeType: string;
      shareUri: string;
      content: AttachmentPreviewContent;
    }
  | {
      phase: 'error';
      filename: string;
      message: string;
    };

type Props = {
  state: AttachmentViewerState | null;
  sharing: boolean;
  onClose: () => void;
  onDownload: () => void;
  onRetry?: () => void;
};

export function AttachmentViewerModal({
  state,
  sharing,
  onClose,
  onDownload,
  onRetry,
}: Props) {
  const visible = state !== null;
  const filename = state?.filename ?? '';
  const canDownload = state?.phase === 'ready';
  const canPreview = state?.phase === 'ready' && state.content.type !== 'unavailable';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={26} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title} numberOfLines={1}>
            {filename || 'Attachment'}
          </Text>
          <TouchableOpacity
            onPress={onDownload}
            disabled={!canDownload || sharing}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Download or share file"
          >
            {sharing ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons
                name="download-outline"
                size={24}
                color={canDownload ? '#fff' : '#666'}
              />
            )}
          </TouchableOpacity>
        </View>

        {state?.phase === 'loading' ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={Gmail.blue} />
            <Text style={styles.loadingTitle}>
              {state.statusText ?? 'Loading attachment…'}
            </Text>
            <Text style={styles.loadingSub} numberOfLines={2}>
              {state.filename}
            </Text>
          </View>
        ) : null}

        {state?.phase === 'error' ? (
          <View style={styles.center}>
            <Ionicons name="alert-circle-outline" size={56} color="#888" />
            <Text style={styles.errorTitle}>Couldn&apos;t open file</Text>
            <Text style={styles.errorSub}>{state.message}</Text>
            {onRetry ? (
              <TouchableOpacity style={styles.retryBtn} onPress={onRetry}>
                <Text style={styles.retryBtnText}>Try again</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {state?.phase === 'ready' && canPreview && state.content.type === 'data-uri' ? (
          <WebView
            source={{
              html: `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body style="margin:0;background:#f6f8fc;display:flex;align-items:center;justify-content:center;min-height:100vh;"><img src="${state.content.uri}" style="max-width:100%;max-height:100vh;object-fit:contain;" alt="" /></body></html>`,
            }}
            style={styles.web}
            originWhitelist={['*']}
            startInLoadingState
            renderLoading={() => (
              <View style={styles.webLoading}>
                <ActivityIndicator color={Gmail.blue} />
              </View>
            )}
          />
        ) : null}

        {state?.phase === 'ready' && canPreview && state.content.type === 'html' ? (
          <WebView
            source={{ html: state.content.html }}
            style={styles.web}
            originWhitelist={['*']}
            startInLoadingState
            renderLoading={() => (
              <View style={styles.webLoading}>
                <ActivityIndicator color={Gmail.blue} />
              </View>
            )}
          />
        ) : null}

        {state?.phase === 'ready' && !canPreview ? (
          <View style={styles.center}>
            <Ionicons name="document-outline" size={64} color="#888" />
            <Text style={styles.errorTitle}>{state.filename}</Text>
            <Text style={styles.errorSub}>Preview isn&apos;t available for this file type.</Text>
            <Text style={styles.errorSub}>Tap the download icon above to save or share.</Text>
            <TouchableOpacity
              style={styles.retryBtn}
              onPress={onDownload}
              disabled={sharing}
            >
              {sharing ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.retryBtnText}>Download / Share</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : null}
      </SafeAreaView>
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
    paddingVertical: 12,
    backgroundColor: '#111',
  },
  title: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    marginHorizontal: 12,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 32,
    backgroundColor: '#1a1a1a',
  },
  loadingTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
    marginTop: 8,
  },
  loadingSub: {
    fontSize: 14,
    color: '#aaa',
    textAlign: 'center',
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    textAlign: 'center',
  },
  errorSub: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    lineHeight: 20,
  },
  retryBtn: {
    marginTop: 12,
    paddingHorizontal: 28,
    paddingVertical: 12,
    backgroundColor: Colors.primary,
    borderRadius: 10,
    minWidth: 140,
    alignItems: 'center',
  },
  retryBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  web: { flex: 1, backgroundColor: '#fff' },
  webLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
});
