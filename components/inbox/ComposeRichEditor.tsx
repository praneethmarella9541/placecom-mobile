import React, { useImperativeHandle, useState, forwardRef } from 'react';
import { View, TextInput, StyleSheet } from 'react-native';
import { htmlToPlain, plainToEditorHtml } from '../../lib/html-email';
import { Gmail } from '../../constants/gmailTheme';

export type ComposeEditorHandle = {
  getHtml: () => Promise<string>;
};

interface EditorProps {
  initialHtml?: string;
  onChangeHtml: (html: string) => void;
}

const ComposeRichEditor = forwardRef<ComposeEditorHandle, EditorProps>(function ComposeRichEditor(
  { initialHtml = '', onChangeHtml },
  ref
) {
  const [text, setText] = useState(() => htmlToPlain(initialHtml));

  useImperativeHandle(
    ref,
    () => ({
      getHtml: async () => plainToEditorHtml(text),
    }),
    [text]
  );

  return (
    <View style={styles.wrap}>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={(next) => {
          setText(next);
          onChangeHtml(plainToEditorHtml(next));
        }}
        placeholder="Compose email"
        placeholderTextColor={Gmail.textMuted}
        multiline
        textAlignVertical="top"
        autoCorrect
        autoCapitalize="sentences"
        scrollEnabled
      />
    </View>
  );
});

export default ComposeRichEditor;

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    minHeight: 160,
    backgroundColor: '#fff',
  },
  input: {
    flex: 1,
    padding: 16,
    fontSize: 15,
    lineHeight: 22,
    color: Gmail.text,
    backgroundColor: '#fff',
  },
});
