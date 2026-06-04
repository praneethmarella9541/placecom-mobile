import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { whatsappApi } from '../../../lib/api';
import { isValidE164, normalizePhone } from '../../../lib/phone';
import { Colors } from '../../../constants/colors';

export default function WhatsAppConversationScreen() {
  const { peer } = useLocalSearchParams<{ peer: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const flatListRef = useRef<FlatList>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [businessLine, setBusinessLine] = useState<string | null>(null);
  const [needsTemplate, setNeedsTemplate] = useState(false);
  const [templateVar1, setTemplateVar1] = useState('');
  const [templateVar2, setTemplateVar2] = useState('');

  const peerDecoded = normalizePhone(decodeURIComponent(peer ?? ''));

  const loadMessages = useCallback(async () => {
    try {
      const data = await whatsappApi.getMessages(peerDecoded);
      setMessages(data.messages ?? []);
      if (data.businessLine) setBusinessLine(data.businessLine);
    } catch {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [peerDecoded]);

  useEffect(() => {
    if (!isValidE164(peerDecoded)) {
      Alert.alert('Invalid number', 'Use +918489431508 or 8489431508');
      router.back();
      return;
    }
    loadMessages();
  }, [loadMessages, peerDecoded, router]);

  useEffect(() => {
    whatsappApi.session(peerDecoded).then((d) => setNeedsTemplate(d.requiresTemplate ?? !d.sessionOpen)).catch(() => setNeedsTemplate(false));
  }, [peerDecoded]);

  async function send() {
    if (needsTemplate) {
      if (!templateVar1.trim() || !templateVar2.trim()) {
        Alert.alert('Template required', 'Enter recipient name and your name for the opening template.');
        return;
      }
    } else if (!text.trim()) {
      return;
    }
    setSending(true);
    try {
      await whatsappApi.send(peerDecoded, {
        text: needsTemplate ? undefined : text.trim(),
        useTemplate: needsTemplate,
        templateVariables: needsTemplate ? [templateVar1.trim(), templateVar2.trim()] : undefined,
      });
      setText('');
      await loadMessages();
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Failed to send');
    } finally {
      setSending(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={Colors.text} />
          </TouchableOpacity>
          <View style={styles.waIcon}>
            <Ionicons name="logo-whatsapp" size={20} color="#25D366" />
          </View>
          <View style={styles.headerInfo}>
            <Text style={styles.headerTitle}>{peerDecoded}</Text>
            <Text style={styles.headerSub}>
              {businessLine ? `via ${businessLine}` : 'WhatsApp'}
            </Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.center}><ActivityIndicator color="#25D366" /></View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <MessageBubble message={item} />}
            contentContainerStyle={{ padding: 16, gap: 8 }}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
          />
        )}

        {needsTemplate ? (
          <View style={styles.templateBox}>
            <Text style={styles.templateTitle}>First message uses approved template</Text>
            <Text style={styles.templateHint}>Hi [name], this is [you] from PlaceCom</Text>
            <View style={styles.templateRow}>
              <TextInput
                style={styles.templateInput}
                value={templateVar1}
                onChangeText={setTemplateVar1}
                placeholder="Recipient name"
                placeholderTextColor={Colors.textMuted}
              />
              <TextInput
                style={styles.templateInput}
                value={templateVar2}
                onChangeText={setTemplateVar2}
                placeholder="Your name"
                placeholderTextColor={Colors.textMuted}
              />
            </View>
          </View>
        ) : null}

        <View style={[styles.inputBar, { paddingBottom: insets.bottom + 8 }]}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder={needsTemplate ? 'Free text after they reply…' : 'Message...'}
            placeholderTextColor={Colors.textMuted}
            multiline
            maxLength={1600}
            editable={!needsTemplate}
          />
          <TouchableOpacity
            style={styles.sendBtn}
            onPress={send}
            disabled={
              sending ||
              (needsTemplate ? !templateVar1.trim() || !templateVar2.trim() : !text.trim())
            }
          >
            {sending ? (
              <ActivityIndicator size="small" color={Colors.surface} />
            ) : (
              <Ionicons name="send" size={18} color={Colors.surface} />
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function MessageBubble({ message }: { message: any }) {
  const isOut = message.direction === 'outbound';
  return (
    <View style={[styles.bubbleWrapper, isOut ? styles.bubbleRight : styles.bubbleLeft]}>
      <View style={[styles.bubble, isOut ? styles.bubbleOut : styles.bubbleIn]}>
        <Text style={[styles.bubbleText, isOut && styles.bubbleTextOut]}>{message.body}</Text>
        {message.num_media > 0 && (
          <Text style={[styles.mediaHint, isOut && styles.mediaHintOut]}>
            📎 {message.num_media} attachment{message.num_media > 1 ? 's' : ''}
          </Text>
        )}
        <Text style={[styles.bubbleTime, isOut && styles.bubbleTimeOut]}>
          {message.created_at ? format(new Date(message.created_at), 'h:mm a') : ''}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ECE5DD' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 16,
    backgroundColor: '#075E54',
    borderBottomWidth: 1,
    borderBottomColor: '#056151',
  },
  waIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E9FAF0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerInfo: { flex: 1 },
  headerTitle: { fontSize: 15, fontWeight: '700', color: Colors.surface },
  headerSub: { fontSize: 12, color: 'rgba(255,255,255,0.8)' },
  bubbleWrapper: { flexDirection: 'row', marginBottom: 2 },
  bubbleLeft: { justifyContent: 'flex-start' },
  bubbleRight: { justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '75%',
    borderRadius: 12,
    padding: 10,
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  bubbleOut: { backgroundColor: '#DCF8C6', borderBottomRightRadius: 2 },
  bubbleIn: { backgroundColor: Colors.surface, borderBottomLeftRadius: 2 },
  bubbleText: { fontSize: 14, color: Colors.text, lineHeight: 20 },
  bubbleTextOut: { color: Colors.text },
  mediaHint: { fontSize: 12, color: Colors.textSecondary },
  mediaHintOut: { color: '#4CAF50' },
  bubbleTime: { fontSize: 10, color: Colors.textMuted, textAlign: 'right' },
  bubbleTimeOut: { color: '#7CB875' },
  templateBox: {
    marginHorizontal: 12,
    marginTop: 8,
    padding: 10,
    backgroundColor: '#FFF8E1',
    borderRadius: 8,
    gap: 6,
  },
  templateTitle: { fontSize: 12, fontWeight: '700', color: '#92400E' },
  templateHint: { fontSize: 11, color: '#B45309' },
  templateRow: { flexDirection: 'row', gap: 8 },
  templateInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    padding: 8,
    fontSize: 14,
    backgroundColor: Colors.surface,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 8,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontSize: 14,
    color: Colors.text,
    minHeight: 40,
    maxHeight: 100,
    backgroundColor: Colors.background,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#25D366',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
