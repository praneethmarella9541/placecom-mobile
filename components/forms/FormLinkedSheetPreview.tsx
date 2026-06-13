import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import WebView from 'react-native-webview';
import { FormsTheme } from '../../constants/formsTheme';
import { loadLinkedSheetPreview } from '../../lib/forms-sheet-preview';
import type { DrivePreviewContent } from '../../lib/drive-preview';

type Phase = 'loading' | 'ready' | 'error';

export function FormLinkedSheetPreview({
  sheetId,
  formTitle,
}: {
  sheetId: string;
  formTitle: string;
}) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [content, setContent] = useState<DrivePreviewContent | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setPhase('loading');
      setContent(null);
      setErrorMessage(null);
      try {
        const preview = await loadLinkedSheetPreview(sheetId, formTitle);
        if (cancelled) return;
        if (preview.type === 'unavailable') {
          setPhase('error');
          setErrorMessage('Could not render spreadsheet preview.');
        } else {
          setContent(preview);
          setPhase('ready');
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setPhase('error');
          setErrorMessage(e instanceof Error ? e.message : 'Could not load spreadsheet');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sheetId, formTitle]);

  if (phase === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={FormsTheme.purple} />
        <Text style={styles.muted}>Loading spreadsheet…</Text>
      </View>
    );
  }

  if (phase === 'error' || !content || content.type === 'unavailable') {
    return (
      <View style={styles.errorBox}>
        <Text style={styles.errorText}>{errorMessage ?? 'Spreadsheet preview unavailable.'}</Text>
      </View>
    );
  }

  if (content.type === 'file-uri') {
    return (
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
            <ActivityIndicator color={FormsTheme.purple} />
          </View>
        )}
      />
    );
  }

  return (
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
          <ActivityIndicator color={FormsTheme.purple} />
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  web: { flex: 1, minHeight: 420, backgroundColor: '#fff', borderRadius: 8 },
  center: { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8, minHeight: 200 },
  muted: { fontSize: 13, color: FormsTheme.textSecondary },
  errorBox: {
    padding: 14,
    backgroundColor: '#FEF2F2',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  errorText: { fontSize: 13, color: '#B91C1C' },
});
