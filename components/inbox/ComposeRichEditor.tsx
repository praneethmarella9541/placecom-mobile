import React, { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  type LayoutChangeEvent,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import WebView, { type WebViewMessageEvent } from 'react-native-webview';
import { Gmail } from '../../constants/gmailTheme';
import { useKeyboardHeight } from '../../hooks/useKeyboardHeight';

const EDITOR_PAGE = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/>
<style>
  html, body { margin:0; padding:0; height:100%; background:#fff; }
  #editor {
    min-height: 100%;
    padding: 16px;
    font-family: Roboto, Arial, sans-serif;
    font-size: 15px;
    line-height: 1.5;
    color: #202124;
    outline: none;
    word-wrap: break-word;
    -webkit-user-select: text;
  }
  #editor:empty:before { content: attr(data-placeholder); color: #80868b; }
</style>
</head><body>
<div id="editor" contenteditable="true" data-placeholder="Compose email"></div>
<script>
  var editor = document.getElementById('editor');

  function postHtml() {
    if (!window.ReactNativeWebView) return;
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'html',
      html: editor.innerHTML
    }));
  }

  function postFormatState() {
    if (!window.ReactNativeWebView) return;
    var fontName = '';
    var fontSize = '';
    try { fontName = document.queryCommandValue('fontName') || ''; } catch (e) {}
    try { fontSize = document.queryCommandValue('fontSize') || ''; } catch (e) {}
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'format',
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'),
      strikeThrough: document.queryCommandState('strikeThrough'),
      unorderedList: document.queryCommandState('insertUnorderedList'),
      orderedList: document.queryCommandState('insertOrderedList'),
      fontName: fontName,
      fontSize: fontSize
    }));
  }

  function syncAll() {
    postHtml();
    postFormatState();
  }

  function postEditorFocus(focused) {
    if (!window.ReactNativeWebView) return;
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'editorFocus', focused: focused }));
  }

  editor.addEventListener('input', syncAll);
  editor.addEventListener('keyup', function(e) {
    postFormatState();
    if (!e.isComposing) postHtml();
  });
  editor.addEventListener('mouseup', postFormatState);
  editor.addEventListener('touchend', function() {
    postFormatState();
    postHtml();
  });
  editor.addEventListener('paste', function() {
    setTimeout(postHtml, 0);
  });
  editor.addEventListener('cut', function() {
    setTimeout(postHtml, 0);
  });
  editor.addEventListener('compositionend', postHtml);
  editor.addEventListener('focus', function() { postEditorFocus(true); });
  editor.addEventListener('blur', function() {
    postHtml();
    postEditorFocus(false);
  });
  document.addEventListener('selectionchange', function() {
    if (document.activeElement === editor) postFormatState();
  });

  window.setEditorHtml = function(html) {
    editor.innerHTML = html || '';
    syncAll();
  };

  window.execEditorCmd = function(cmd, val) {
    editor.focus();
    try { document.execCommand(cmd, false, val || null); } catch (e) {}
    syncAll();
  };

  window.requestFormatState = function() {
    postFormatState();
  };

  window.readEditorHtml = function() {
    return editor ? editor.innerHTML : '';
  };

  syncAll();
</script>
</body></html>`;

export type FormatState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikeThrough: boolean;
  unorderedList: boolean;
  orderedList: boolean;
  fontName: string;
  fontSize: string;
};

const DEFAULT_FORMAT: FormatState = {
  bold: false,
  italic: false,
  underline: false,
  strikeThrough: false,
  unorderedList: false,
  orderedList: false,
  fontName: '',
  fontSize: '',
};

const FONT_FAMILIES = [
  { label: 'Sans', value: 'Arial' },
  { label: 'Serif', value: 'Georgia' },
  { label: 'Mono', value: 'Courier New' },
];

const FONT_SIZES = [
  { label: 'S', value: '2' },
  { label: 'M', value: '3' },
  { label: 'L', value: '4' },
  { label: 'XL', value: '5' },
];

type FormatBtn = {
  id: keyof Pick<FormatState, 'bold' | 'italic' | 'underline' | 'strikeThrough' | 'unorderedList' | 'orderedList'>;
  icon?: keyof typeof Ionicons.glyphMap;
  mciIcon?: keyof typeof MaterialCommunityIcons.glyphMap;
  cmd: string;
  label?: string;
};

const FORMAT_BTNS: FormatBtn[] = [
  { id: 'bold', icon: 'text', cmd: 'bold', label: 'B' },
  { id: 'italic', icon: 'text', cmd: 'italic', label: 'I' },
  { id: 'underline', icon: 'text', cmd: 'underline', label: 'U' },
  { id: 'strikeThrough', icon: 'text', cmd: 'strikeThrough', label: 'S' },
  { id: 'unorderedList', mciIcon: 'format-list-bulleted', cmd: 'insertUnorderedList' },
  { id: 'orderedList', mciIcon: 'format-list-numbered', cmd: 'insertOrderedList' },
];

function fontMatches(stateName: string, expected: string): boolean {
  if (!stateName) return false;
  return stateName.toLowerCase().includes(expected.toLowerCase().split(' ')[0]);
}

export type ComposeEditorHandle = {
  /** Read the live editor HTML (WebView is source of truth). */
  getHtml: () => Promise<string>;
};

interface EditorProps {
  initialHtml?: string;
  onChangeHtml: (html: string) => void;
  onFormatStateChange?: (state: FormatState) => void;
  onEditorFocusChange?: (focused: boolean) => void;
  webRef?: React.RefObject<WebView | null>;
  onReady?: () => void;
  contentInsetBottom?: number;
}

const HTML_REQUEST_TIMEOUT_MS = 2500;

/** Rich-text body (WebView only). Pair with ComposeFormatToolbar below the editor. */
export const ComposeEditorBody = forwardRef<ComposeEditorHandle, EditorProps>(function ComposeEditorBody(
  {
    initialHtml = '',
    onChangeHtml,
    onFormatStateChange,
    onEditorFocusChange,
    webRef: externalRef,
    onReady,
    contentInsetBottom = 0,
  },
  ref
) {
  const internalRef = useRef<WebView>(null);
  const webRef = externalRef ?? internalRef;
  const [ready, setReady] = useState(false);
  const initialSetRef = useRef(false);
  const pendingHtmlRequest = useRef<((html: string) => void) | null>(null);
  const latestHtmlRef = useRef(initialHtml);

  useEffect(() => {
    latestHtmlRef.current = initialHtml;
  }, [initialHtml]);

  const setInitialContent = useCallback(() => {
    if (initialSetRef.current || !ready) return;
    initialSetRef.current = true;
    webRef.current?.injectJavaScript(
      `window.setEditorHtml(${JSON.stringify(initialHtml || '')}); true;`
    );
  }, [initialHtml, ready, webRef]);

  const requestHtmlSnapshot = useCallback((): Promise<string> => {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (html: string) => {
        if (settled) return;
        settled = true;
        pendingHtmlRequest.current = null;
        const value = html || latestHtmlRef.current || '';
        latestHtmlRef.current = value;
        resolve(value);
      };

      pendingHtmlRequest.current = finish;
      webRef.current?.injectJavaScript(`
        (function() {
          var html = (window.readEditorHtml && window.readEditorHtml()) || '';
          if (!window.ReactNativeWebView) return;
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'htmlSnapshot',
            html: html
          }));
        })();
        true;
      `);
      setTimeout(() => finish(latestHtmlRef.current), HTML_REQUEST_TIMEOUT_MS);
    });
  }, [webRef]);

  useImperativeHandle(
    ref,
    () => ({
      getHtml: async () => {
        const snap = await requestHtmlSnapshot();
        return snap || latestHtmlRef.current || '';
      },
    }),
    [requestHtmlSnapshot]
  );

  const onLoadEnd = useCallback(() => {
    setReady(true);
    setInitialContent();
    webRef.current?.injectJavaScript('window.requestFormatState(); true;');
    onReady?.();
  }, [setInitialContent, onReady, webRef]);

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      try {
        const data = JSON.parse(e.nativeEvent.data);
        if (
          (data.type === 'html' || data.type === 'htmlSnapshot') &&
          typeof data.html === 'string'
        ) {
          // The WebView fires syncAll() with empty innerHTML on first load, before
          // setEditorHtml() is injected via setInitialContent(). Skip that empty
          // message to prevent overwriting a non-empty bodyHtmlRef in the parent.
          if (!initialSetRef.current && !data.html.trim()) {
            // Seed latestHtmlRef with the known initial value so getHtml() snapshots
            // (e.g. taken while the draft is loading) still return sensible content.
            if (initialHtml.trim()) latestHtmlRef.current = initialHtml;
            return;
          }
          latestHtmlRef.current = data.html;
          if (pendingHtmlRequest.current) {
            pendingHtmlRequest.current(data.html);
          }
          onChangeHtml(data.html);
        }
        if (data.type === 'format') {
          onFormatStateChange?.({
            bold: !!data.bold,
            italic: !!data.italic,
            underline: !!data.underline,
            strikeThrough: !!data.strikeThrough,
            unorderedList: !!data.unorderedList,
            orderedList: !!data.orderedList,
            fontName: String(data.fontName ?? ''),
            fontSize: String(data.fontSize ?? ''),
          });
        }
        if (data.type === 'editorFocus') {
          onEditorFocusChange?.(!!data.focused);
        }
      } catch {
        /* ignore */
      }
    },
    [onChangeHtml, onFormatStateChange, onEditorFocusChange, initialHtml]
  );

  return (
    <View style={[styles.editorWrap, contentInsetBottom > 0 && { paddingBottom: contentInsetBottom }]}>
      {!ready && (
        <View style={styles.editorLoading}>
          <ActivityIndicator color={Gmail.blue} />
        </View>
      )}
      <WebView
        ref={webRef}
        source={{ html: EDITOR_PAGE, baseUrl: 'about:blank' }}
        style={styles.webview}
        originWhitelist={['*']}
        scrollEnabled
        nestedScrollEnabled
        onMessage={onMessage}
        onLoadEnd={onLoadEnd}
        javaScriptEnabled
        domStorageEnabled
        keyboardDisplayRequiresUserAction={false}
      />
    </View>
  );
});

interface ToolbarProps {
  webRef: React.RefObject<WebView | null>;
  format: FormatState;
  bottomOffset: number;
  onLayout?: (e: LayoutChangeEvent) => void;
}

/** Formatting bar pinned above the keyboard (or safe area when keyboard is hidden). */
export function ComposeFormatToolbar({ webRef, format, bottomOffset, onLayout }: ToolbarProps) {
  const [fontMenuOpen, setFontMenuOpen] = useState(false);
  const [sizeMenuOpen, setSizeMenuOpen] = useState(false);

  const runCmd = useCallback(
    (cmd: string, value?: string) => {
      const val = value === undefined ? 'null' : JSON.stringify(value);
      webRef.current?.injectJavaScript(
        `window.execEditorCmd(${JSON.stringify(cmd)}, ${val}); true;`
      );
    },
    [webRef]
  );

  const closeMenus = useCallback(() => {
    setFontMenuOpen(false);
    setSizeMenuOpen(false);
  }, []);

  const activeFont = FONT_FAMILIES.find((f) => fontMatches(format.fontName, f.value));
  const activeSize = FONT_SIZES.find((s) => s.value === format.fontSize);

  return (
    <View
      onLayout={onLayout}
      style={[styles.toolbarDock, styles.toolbarFloating, { bottom: bottomOffset }]}
    >
      {(fontMenuOpen || sizeMenuOpen) && (
        <View style={styles.subMenuPanel}>
          {fontMenuOpen && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.subMenuRow}>
              {FONT_FAMILIES.map((f) => {
                const selected = fontMatches(format.fontName, f.value);
                return (
                  <SubMenuChip
                    key={f.value}
                    label={f.label}
                    active={selected}
                    onPress={() => {
                      runCmd('fontName', f.value);
                      closeMenus();
                    }}
                  />
                );
              })}
            </ScrollView>
          )}
          {sizeMenuOpen && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.subMenuRow}>
              {FONT_SIZES.map((s) => {
                const selected = format.fontSize === s.value;
                return (
                  <SubMenuChip
                    key={s.value}
                    label={s.label}
                    active={selected}
                    onPress={() => {
                      runCmd('fontSize', s.value);
                      closeMenus();
                    }}
                  />
                );
              })}
            </ScrollView>
          )}
        </View>
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.toolbarScroll}
        keyboardShouldPersistTaps="always"
      >
        <ToolbarIcon
          icon="text-outline"
          label="Font"
          active={fontMenuOpen || !!activeFont}
          subtitle={activeFont?.label}
          onPress={() => {
            setSizeMenuOpen(false);
            setFontMenuOpen((v) => !v);
          }}
        />
        <ToolbarIcon
          icon="resize-outline"
          label="Size"
          active={sizeMenuOpen || !!activeSize}
          subtitle={activeSize?.label}
          onPress={() => {
            setFontMenuOpen(false);
            setSizeMenuOpen((v) => !v);
          }}
        />
        <View style={styles.toolbarDivider} />
        {FORMAT_BTNS.map((b) => (
          <ToolbarIcon
            key={b.id}
            icon={b.icon}
            mciIcon={b.mciIcon}
            label={b.label}
            active={format[b.id]}
            onPress={() => runCmd(b.cmd)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

/** Combined editor + toolbar (toolbar docked at bottom of this block). */
const ComposeRichEditor = forwardRef<
  ComposeEditorHandle,
  {
    initialHtml?: string;
    onChangeHtml: (html: string) => void;
    bottomInset?: number;
  }
>(function ComposeRichEditor({ initialHtml = '', onChangeHtml, bottomInset = 0 }, ref) {
  const webRef = useRef<WebView>(null);
  const editorBodyRef = useRef<ComposeEditorHandle>(null);
  const [format, setFormat] = useState<FormatState>(DEFAULT_FORMAT);
  const [editorFocused, setEditorFocused] = useState(false);
  const [toolbarHeight, setToolbarHeight] = useState(56);
  const keyboardHeight = useKeyboardHeight();

  const keyboardOpen = keyboardHeight > 0;
  const toolbarBottom = keyboardOpen ? keyboardHeight : bottomInset;
  const showToolbar = editorFocused;

  const onToolbarLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0) setToolbarHeight(h);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      getHtml: () => editorBodyRef.current?.getHtml() ?? Promise.resolve(''),
    }),
    []
  );

  return (
    <View style={styles.composeBlock}>
      <ComposeEditorBody
        ref={editorBodyRef}
        initialHtml={initialHtml}
        onChangeHtml={onChangeHtml}
        onFormatStateChange={setFormat}
        onEditorFocusChange={setEditorFocused}
        webRef={webRef}
        contentInsetBottom={showToolbar ? toolbarHeight + 8 : 0}
      />
      {showToolbar && (
        <ComposeFormatToolbar
          webRef={webRef}
          format={format}
          bottomOffset={toolbarBottom}
          onLayout={onToolbarLayout}
        />
      )}
    </View>
  );
});

export default ComposeRichEditor;

function ToolbarIcon({
  icon,
  mciIcon,
  label,
  subtitle,
  active,
  onPress,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  mciIcon?: keyof typeof MaterialCommunityIcons.glyphMap;
  label?: string;
  subtitle?: string;
  active?: boolean;
  onPress: () => void;
}) {
  const iconColor = active ? Gmail.blue : Gmail.textSecondary;

  return (
    <TouchableOpacity
      style={[styles.toolBtn, active && styles.toolBtnActive]}
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityState={{ selected: !!active }}
    >
      {label && label.length === 1 ? (
        <Text
          style={[
            styles.toolBtnLetter,
            active && styles.toolBtnLetterActive,
            label === 'I' && active && styles.toolBtnItalic,
            label === 'U' && active && styles.toolBtnUnderline,
            label === 'S' && active && styles.toolBtnStrike,
          ]}
        >
          {label}
        </Text>
      ) : mciIcon ? (
        <MaterialCommunityIcons name={mciIcon} size={22} color={iconColor} />
      ) : icon ? (
        <Ionicons name={icon} size={22} color={iconColor} />
      ) : null}
      {active && subtitle ? (
        <Text style={styles.toolBtnSubtitle}>{subtitle}</Text>
      ) : null}
      {active && <View style={styles.activeIndicator} />}
    </TouchableOpacity>
  );
}

function SubMenuChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.subChip, active && styles.subChipActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.subChipText, active && styles.subChipTextActive]}>{label}</Text>
      {active && <Ionicons name="checkmark" size={14} color={Gmail.blue} style={{ marginLeft: 4 }} />}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  composeBlock: { flex: 1, minHeight: 160, position: 'relative', zIndex: 1 },
  editorWrap: { flex: 1, backgroundColor: '#fff' },
  webview: { flex: 1, backgroundColor: '#fff' },
  editorLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    zIndex: 1,
  },
  toolbarDock: {
    backgroundColor: Gmail.bg,
    borderTopWidth: 1,
    borderTopColor: Gmail.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 12,
  },
  toolbarFloating: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 30,
  },
  subMenuPanel: {
    borderBottomWidth: 1,
    borderBottomColor: Gmail.divider,
    backgroundColor: Gmail.bgMuted,
    minHeight: 48,
    justifyContent: 'center',
  },
  toolbarScroll: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 6,
    alignItems: 'center',
  },
  toolbarDivider: {
    width: 1,
    height: 28,
    backgroundColor: Gmail.border,
    marginHorizontal: 4,
  },
  toolBtn: {
    minWidth: 44,
    height: 44,
    paddingHorizontal: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: 'transparent',
    position: 'relative',
  },
  toolBtnActive: {
    backgroundColor: Gmail.blueLight,
    borderColor: Gmail.blue,
  },
  toolBtnLetter: {
    fontSize: 17,
    fontWeight: '700',
    color: Gmail.textSecondary,
  },
  toolBtnLetterActive: {
    color: Gmail.blue,
  },
  toolBtnItalic: { fontStyle: 'italic' },
  toolBtnUnderline: { textDecorationLine: 'underline' },
  toolBtnStrike: { textDecorationLine: 'line-through' },
  toolBtnSubtitle: {
    position: 'absolute',
    bottom: 2,
    fontSize: 8,
    fontWeight: '700',
    color: Gmail.blue,
  },
  activeIndicator: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Gmail.blue,
  },
  subMenuRow: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    alignItems: 'center',
  },
  subChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: Gmail.bg,
    borderWidth: 1.5,
    borderColor: Gmail.border,
  },
  subChipActive: {
    backgroundColor: Gmail.blueLight,
    borderColor: Gmail.blue,
  },
  subChipText: { fontSize: 13, fontWeight: '500', color: Gmail.text },
  subChipTextActive: { color: Gmail.blue, fontWeight: '700' },
});
