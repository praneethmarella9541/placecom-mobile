import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import WebView from 'react-native-webview';
import type { DriveFile } from '../../lib/types';
import { DriveTheme } from '../../constants/driveTheme';
import {
  buildDrivePreviewContent,
  canPreviewDriveFile,
  getDrivePreviewKind,
  resolveDrivePreviewFile,
  pdfUriToPdfJsHtml,
  type DrivePreviewContent,
} from '../../lib/drive-preview';

type PreviewPhase = 'loading' | 'ready' | 'unavailable' | 'error';

export function DrivePreviewModal({
  visible,
  file,
  downloading = false,
  onClose,
  onDownload,
}: {
  visible: boolean;
  file: DriveFile | null;
  downloading?: boolean;
  onClose: () => void;
  onDownload: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<PreviewPhase>('loading');
  const [content, setContent] = useState<DrivePreviewContent | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !file) {
      setPhase('loading');
      setContent(null);
      setErrorMessage(null);
      return;
    }

    let cancelled = false;

    (async () => {
      setPhase('loading');
      setContent(null);
      setErrorMessage(null);

      if (!canPreviewDriveFile(file)) {
        if (!cancelled) setPhase('unavailable');
        return;
      }

      const kind = getDrivePreviewKind(file);

      try {
        const localUri = await resolveDrivePreviewFile(file);
        const preview = await buildDrivePreviewContent(localUri, file, kind);
        if (cancelled) return;
        if (preview.type === 'unavailable') {
          setPhase('unavailable');
        } else {
          setContent(preview);
          setPhase('ready');
        }
      } catch (e: any) {
        if (!cancelled) {
          setErrorMessage(e?.message ?? 'Could not load preview');
          setPhase('error');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, file?.id, file?.name, file?.mimeType]);

  const fileName = file?.name ?? '';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
          <TouchableOpacity onPress={onClose} style={styles.headerBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={26} color={DriveTheme.text} />
          </TouchableOpacity>
          <Text style={styles.title} numberOfLines={1}>
            {fileName}
          </Text>
          <TouchableOpacity
            onPress={onDownload}
            style={styles.headerBtn}
            disabled={downloading || !file}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {downloading ? (
              <ActivityIndicator size="small" color={DriveTheme.blue} />
            ) : (
              <Ionicons name="download-outline" size={24} color={DriveTheme.blue} />
            )}
          </TouchableOpacity>
        </View>

        {phase === 'loading' && (
          <View style={styles.center}>
            <ActivityIndicator color={DriveTheme.blue} size="large" />
            <Text style={styles.loadingText}>Loading preview…</Text>
          </View>
        )}

        {phase === 'ready' && content?.type === 'file-uri' && (
          <WebView
            source={{ uri: content.uri }}
            style={styles.web}
            originWhitelist={['*', 'file://']}
            allowFileAccess
            allowUniversalAccessFromFileURLs
            allowFileAccessFromFileURLs
            setSupportMultipleWindows={false}
            startInLoadingState
            renderLoading={() => (
              <View style={styles.center}>
                <ActivityIndicator color={DriveTheme.blue} size="large" />
              </View>
            )}
            onError={async () => {
              if (content.type !== 'file-uri') return;
              try {
                const html = await pdfUriToPdfJsHtml(content.uri);
                setContent({ type: 'html', html });
              } catch {
                setPhase('error');
                setErrorMessage('Could not display PDF on this device. Try Download.');
              }
            }}
          />
        )}

        {phase === 'ready' && content?.type === 'html' && (
          <WebView
            source={{ html: content.html }}
            style={styles.web}
            originWhitelist={['*']}
            allowFileAccess
            javaScriptEnabled
            domStorageEnabled
            mixedContentMode="always"
            setSupportMultipleWindows={false}
            startInLoadingState
            renderLoading={() => (
              <View style={styles.center}>
                <ActivityIndicator color={DriveTheme.blue} size="large" />
              </View>
            )}
            onError={() => {
              if (Platform.OS === 'android') {
                setPhase('error');
                setErrorMessage('Could not render preview. Try Download.');
              }
            }}
          />
        )}

        {(phase === 'unavailable' || phase === 'error') && (
          <View style={styles.center}>
            <Ionicons name="document-outline" size={56} color={DriveTheme.textMuted} />
            <Text style={styles.unavailableTitle}>
              {phase === 'error' ? 'Preview failed' : 'Preview not available'}
            </Text>
            <Text style={styles.unavailableSub}>
              {phase === 'error'
                ? errorMessage ?? 'Something went wrong'
                : 'This file type cannot be previewed. Supported: PDF, JPG/PNG, CSV, Excel (.xlsx), and PowerPoint (as PDF when exported).'}
            </Text>
            <TouchableOpacity
              style={styles.downloadBtn}
              onPress={onDownload}
              disabled={downloading || !file}
            >
              {downloading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.downloadBtnText}>Download</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: DriveTheme.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 12,
    backgroundColor: DriveTheme.bg,
    borderBottomWidth: 1,
    borderBottomColor: DriveTheme.border,
    gap: 4,
  },
  headerBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    color: DriveTheme.text,
    textAlign: 'center',
  },
  web: { flex: 1, backgroundColor: '#fff' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: DriveTheme.bgMuted,
    gap: 12,
  },
  loadingText: { fontSize: 15, color: DriveTheme.textSecondary, marginTop: 8 },
  unavailableTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: DriveTheme.text,
    textAlign: 'center',
  },
  unavailableSub: {
    fontSize: 14,
    color: DriveTheme.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  downloadBtn: {
    marginTop: 8,
    paddingHorizontal: 28,
    paddingVertical: 12,
    backgroundColor: DriveTheme.blue,
    borderRadius: 24,
    minWidth: 140,
    alignItems: 'center',
  },
  downloadBtnText: { fontSize: 15, fontWeight: '600', color: '#fff' },
});
