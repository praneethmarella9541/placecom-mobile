import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { format } from 'date-fns';
import { Ionicons } from '@expo/vector-icons';
import type { WhatsAppMessage } from '../../lib/whatsapp-types';
import { Colors } from '../../constants/colors';
import { getDeliveryFailureAdvice, showWhatsAppFailureDetail } from '../../lib/whatsapp-delivery';
import { isEmojiOnlyMessage, isImageMessage } from '../../lib/whatsapp-message-display';
import {
  isAudioMessage,
  resolveWhatsAppMediaUrl,
  whatsAppMediaSource,
} from '../../lib/whatsapp-media';
import { getWhatsAppTickLevel } from '../../lib/whatsapp-tick-level';
import { WhatsAppAudioBubble } from './WhatsAppAudioBubble';

// ── Tick rendering as nested Text (no View → no flickering / overlap) ────────

const GREY = '#8696A0';
const BLUE = '#53BDEB';
const FAIL_RED = '#EF4444';

/** Returns the tick string + colour for a given delivery status. */
function tickInfo(deliveryStatus?: string | null): { str: string; color: string } | null {
  const level = getWhatsAppTickLevel(deliveryStatus);
  switch (level) {
    case 'failed':    return { str: ' !', color: FAIL_RED };
    case 'pending':   return { str: ' ·', color: GREY };      // clock-like indicator
    case 'read':      return { str: ' ✓✓', color: BLUE };
    case 'delivered': return { str: ' ✓✓', color: GREY };
    default:          return { str: ' ✓', color: GREY };       // sent
  }
}

// ─────────────────────────────────────────────────────────────────────────────

type Props = {
  message: WhatsAppMessage;
  highlighted?: boolean;
  authToken?: string | null;
  onImagePress?: (uri: string) => void;
  onLongPress?: () => void;
};

export function WhatsAppMessageBubble({
  message,
  highlighted,
  authToken,
  onImagePress,
  onLongPress,
}: Props) {
  const [imageFailed, setImageFailed] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);

  const isOut  = message.direction === 'outbound';
  const isImage = isImageMessage(message);
  const isAudio = isAudioMessage(message);
  const showMedia = !!message.media_url;
  const mediaUri = resolveWhatsAppMediaUrl(message.media_url);
  const mediaSource = whatsAppMediaSource(mediaUri, authToken);
  const body  = message.body?.trim() ?? '';
  const emojiOnly   = !showMedia && isEmojiOnlyMessage(body);
  const caption     = showMedia && isImage && body && body !== '[Image]' ? body : '';
  const showTextBody = !showMedia && !!body && !emojiOnly;

  const timeLabel = message.created_at
    ? format(new Date(message.created_at), 'h:mm a')
    : '';

  const ticks = isOut ? tickInfo(message.delivery_status) : null;

  // ── Meta row used for non-text bubbles (images, files, emoji) ────────────
  const MetaRow = () => (
    <View style={styles.metaRow}>
      <Text style={[styles.time, isOut && styles.timeOut]}>{timeLabel}</Text>
      {ticks ? (
        <Text style={[styles.tickText, { color: ticks.color }]}>{ticks.str.trim()}</Text>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.wrapper, isOut ? styles.right : styles.left]}>
      <Pressable onLongPress={onLongPress} delayLongPress={300} android_ripple={null}>
        <View
          style={[
            styles.bubble,
            isOut ? styles.bubbleOut : styles.bubbleIn,
            emojiOnly  && styles.bubbleEmoji,
            isImage && mediaUri && !imageFailed && styles.bubbleImage,
            highlighted && styles.bubbleHighlight,
          ]}
        >
          {/* ── Image ─────────────────────────────────────────────────── */}
          {showMedia && isImage && mediaUri && !imageFailed ? (
            <TouchableOpacity
              activeOpacity={0.92}
              onPress={() => onImagePress?.(mediaUri)}
            >
              <Image
                source={mediaSource ?? { uri: mediaUri }}
                style={styles.image}
                resizeMode="cover"
                onLoadStart={() => setImageLoading(true)}
                onLoadEnd={() => setImageLoading(false)}
                onError={() => {
                  setImageLoading(false);
                  setImageFailed(true);
                }}
              />
              {imageLoading ? (
                <View style={styles.imageLoading}>
                  <ActivityIndicator color="#fff" />
                </View>
              ) : null}
              {/* Time pill overlaid on image */}
              <View style={styles.imageMeta}>
                <Text style={styles.imageTime}>{timeLabel}</Text>
                {ticks ? (
                  <Text style={[styles.imageTickText, { color: 'rgba(255,255,255,0.85)' }]}>
                    {ticks.str.trim()}
                  </Text>
                ) : null}
              </View>
            </TouchableOpacity>
          ) : null}

          {/* ── Image that failed to load → fall back to a tappable chip ─ */}
          {showMedia && isImage && (imageFailed || !mediaUri) ? (
            <>
              <TouchableOpacity
                style={styles.fileChip}
                onPress={() => mediaUri && onImagePress?.(mediaUri)}
              >
                <Ionicons name="image" size={18} color={isOut ? '#075E54' : Colors.primary} />
                <Text style={styles.fileText} numberOfLines={1}>Tap to open image</Text>
              </TouchableOpacity>
              <MetaRow />
            </>
          ) : null}

          {/* ── Audio / voice note ────────────────────────────────────── */}
          {showMedia && !isImage && isAudio && mediaSource ? (
            <>
              <WhatsAppAudioBubble source={mediaSource} outbound={isOut} />
              <MetaRow />
            </>
          ) : null}

          {/* ── File / document ───────────────────────────────────────── */}
          {showMedia && !isImage && !isAudio ? (
            <>
              <TouchableOpacity
                style={styles.fileChip}
                onPress={() => mediaUri && onImagePress?.(mediaUri)}
              >
                <Ionicons
                  name="document-attach"
                  size={18}
                  color={isOut ? '#075E54' : Colors.primary}
                />
                <Text style={styles.fileText} numberOfLines={1}>
                  {body.startsWith('[') ? body : 'Attachment'}
                </Text>
              </TouchableOpacity>
              <MetaRow />
            </>
          ) : null}

          {/* ── Emoji-only ────────────────────────────────────────────── */}
          {emojiOnly ? (
            <>
              <Text style={styles.emojiBody}>{body}</Text>
              <MetaRow />
            </>
          ) : null}

          {/* ── Plain text ────────────────────────────────────────────── *
           *
           *  The timestamp + ticks are rendered as NESTED <Text> nodes
           *  inside the same <Text> as the message body.  This means:
           *    • No absolute positioning → zero flickering / overlap
           *    • React Native reflows the whole thing as a single paragraph
           *    • Short messages → time sits on the same visual line
           *    • Long (wrapped) messages → time falls after the last word
           *
           *  A tiny non-breaking-space prefix on the time creates the same
           *  small visual gap WhatsApp shows.
           * ──────────────────────────────────────────────────────────── */}
          {showTextBody ? (
            <Text style={[styles.body, isOut && styles.bodyOut]}>
              {body}
              {/* Inline timestamp — always flows with the text naturally */}
              <Text style={[styles.inlineTime, isOut && styles.inlineTimeOut]}>
                {'\u00A0\u00A0'}{timeLabel}
              </Text>
              {ticks ? (
                <Text style={[styles.inlineTicks, { color: ticks.color }]}>
                  {ticks.str}
                </Text>
              ) : null}
            </Text>
          ) : null}

          {/* Delivery failure hint (below the text paragraph) */}
          {showTextBody && showWhatsAppFailureDetail(message.delivery_status) ? (
            <Text style={styles.failHint}>
              {message.delivery_status?.replace(/^failed:\s*/i, '') || 'Not delivered'}
            </Text>
          ) : null}
          {showTextBody && isOut && getDeliveryFailureAdvice(message.delivery_status) ? (
            <Text style={styles.advice} numberOfLines={4}>
              {getDeliveryFailureAdvice(message.delivery_status)}
            </Text>
          ) : null}

          {/* Caption under image */}
          {caption ? (
            <Text style={[styles.caption, isOut && styles.bodyOut]}>{caption}</Text>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flexDirection: 'row', marginBottom: 2 },
  left:    { justifyContent: 'flex-start' },
  right:   { justifyContent: 'flex-end' },

  bubble: {
    maxWidth: '82%',
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingTop: 6,
    paddingBottom: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 2,
    elevation: 1,
  },
  bubbleOut:       { backgroundColor: '#DCF8C6', borderBottomRightRadius: 2 },
  bubbleIn:        { backgroundColor: Colors.surface, borderBottomLeftRadius: 2 },
  bubbleEmoji:     { paddingHorizontal: 10, paddingVertical: 4 },
  bubbleImage:     { padding: 3, overflow: 'hidden' },
  bubbleHighlight: { borderWidth: 2, borderColor: '#25D366' },

  // Image
  image: { width: 240, height: 200, borderRadius: 6, backgroundColor: Colors.border },
  imageLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageMeta: {
    position: 'absolute', right: 6, bottom: 6,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2,
  },
  imageTime:     { fontSize: 11, color: '#fff', fontWeight: '500' },
  imageTickText: { fontSize: 11 },

  // File
  fileChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 8, backgroundColor: 'rgba(0,0,0,0.04)', borderRadius: 8, marginBottom: 4,
  },
  fileText: { flex: 1, fontSize: 13, color: Colors.text },

  // Emoji
  emojiBody: { fontSize: 40, lineHeight: 46, textAlign: 'center', includeFontPadding: false },

  // Meta row for non-text content (file / emoji)
  metaRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'flex-end', gap: 4, marginTop: 2,
  },

  // ── Plain text body ──────────────────────────────────────────────────────
  body: {
    fontSize: 15,
    color: Colors.text,
    lineHeight: 21,
  },
  bodyOut: { color: Colors.text },

  // Inline time — nested <Text>, smaller than body, vertically shifted down
  // so it sits at the baseline of the last text line
  inlineTime: {
    fontSize: 11,
    color: Colors.textMuted,
    lineHeight: 21,   // matches body so it sits on the same baseline
  },
  inlineTimeOut: { color: '#7E9B7A' },

  // Inline ticks — nested <Text>
  inlineTicks: {
    fontSize: 11,
    lineHeight: 21,
  },

  // Shared small time text (non-inline uses)
  time:     { fontSize: 11, color: Colors.textMuted },
  timeOut:  { color: '#7E9B7A' },
  tickText: { fontSize: 11 },

  caption: { fontSize: 14, color: Colors.text, lineHeight: 19, paddingHorizontal: 4, paddingBottom: 2 },
  failHint: { fontSize: 11, color: FAIL_RED, lineHeight: 15, marginTop: 3 },
  advice:   { fontSize: 11, color: '#B45309', lineHeight: 15, marginTop: 2 },
});
