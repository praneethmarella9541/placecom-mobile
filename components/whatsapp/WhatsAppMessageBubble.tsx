import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Gesture, GestureDetector, Pressable as GHPressable } from 'react-native-gesture-handler';
import Reanimated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { format } from 'date-fns';
import { Ionicons } from '@expo/vector-icons';
import type { WhatsAppMessage } from '../../lib/whatsapp-types';
import { Colors } from '../../constants/colors';
import { getDeliveryFailureAdvice, showWhatsAppFailureDetail } from '../../lib/whatsapp-delivery';
import { isEmojiOnlyMessage, isImageMessage } from '../../lib/whatsapp-message-display';
import { mediaFilenameFromMessage } from '../../lib/whatsapp-media-helpers';

// Placeholder bodies that Twilio inserts when media arrives without a stored URL
const MEDIA_PLACEHOLDER_RE = /^\[(Image|Video|Audio|Voice|Document|Sticker|Location)\]$/i;
import {
  isAudioMessage,
  isVideoMessage,
  resolveWhatsAppMediaUrl,
  whatsAppMediaSource,
} from '../../lib/whatsapp-media';
import { WhatsAppAudioBubble } from './WhatsAppAudioBubble';
import { WhatsAppQuotedReply } from './WhatsAppQuotedReply';
import { WhatsAppTicks } from './WhatsAppTicks';

const FAIL_RED = '#EF4444';


function BubbleMetaContent({
  timeLabel,
  isOut,
  deliveryStatus,
  light = false,
}: {
  timeLabel: string;
  isOut: boolean;
  deliveryStatus?: string | null;
  light?: boolean;
}) {
  return (
    <>
      <Text style={[styles.time, isOut && !light && styles.timeOut, light && styles.timeLight]}>
        {timeLabel}
      </Text>
      {isOut ? <WhatsAppTicks deliveryStatus={deliveryStatus} light={light} /> : null}
    </>
  );
}

/** Time + ticks in a bottom row (audio, files, emoji). */
function BubbleMetaRow({
  timeLabel,
  isOut,
  deliveryStatus,
}: {
  timeLabel: string;
  isOut: boolean;
  deliveryStatus?: string | null;
}) {
  return (
    <View style={styles.metaRow}>
      <BubbleMetaContent
        timeLabel={timeLabel}
        isOut={isOut}
        deliveryStatus={deliveryStatus}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

type Props = {
  message: WhatsAppMessage;
  highlighted?: boolean;
  authToken?: string | null;
  peerName?: string;
  quotedMessage?: WhatsAppMessage | null;
  onImagePress?: (uri: string) => void;
  onQuotedPress?: () => void;
  onSwipeReply?: () => void;
  onLongPress?: () => void;
};

export function WhatsAppMessageBubble({
  message,
  highlighted,
  authToken,
  peerName = 'Contact',
  quotedMessage,
  onImagePress,
  onQuotedPress,
  onSwipeReply,
  onLongPress,
}: Props) {
  const translateX = useSharedValue(0);
  const [imageFailed, setImageFailed] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);

  const isOut  = message.direction === 'outbound';
  const isImage = isImageMessage(message);
  const isAudio = isAudioMessage(message);
  const isVideo = isVideoMessage(message);
  const showMedia = !!message.media_url;
  const mediaUri = resolveWhatsAppMediaUrl(message.media_url) ?? message.media_url ?? null;
  const isLocalMedia =
    !!mediaUri && (mediaUri.startsWith('file:') || mediaUri.startsWith('content:'));
  const mediaSource = isLocalMedia
    ? { uri: mediaUri }
    : whatsAppMediaSource(mediaUri, authToken);
  const body = message.body ?? '';
  const bodyTrimmed = body.trim();
  const emojiOnly = !showMedia && isEmojiOnlyMessage(bodyTrimmed);
  // Body is a Twilio placeholder but has no stored media_url → render as a chip, not raw text
  const isOrphanPlaceholder = !showMedia && MEDIA_PLACEHOLDER_RE.test(bodyTrimmed);
  const caption = showMedia && isImage && bodyTrimmed && bodyTrimmed !== '[Image]' ? body : '';
  const showTextBody = !showMedia && !!bodyTrimmed && !emojiOnly && !isOrphanPlaceholder;
  const attachmentLabel = mediaFilenameFromMessage(message);

  const timeLabel = message.created_at
    ? format(new Date(message.created_at), 'h:mm a')
    : '';

  const metaProps = {
    timeLabel,
    isOut,
    deliveryStatus: message.delivery_status,
  };

  const triggerSwipeReply = useCallback(() => {
    onSwipeReply?.();
  }, [onSwipeReply]);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-22, 22])
        .failOffsetY([-18, 18])
        .enabled(!!onSwipeReply)
        .onUpdate((e) => {
          if (isOut && e.translationX < 0) {
            translateX.value = Math.max(e.translationX * 0.35, -40);
          } else if (!isOut && e.translationX > 0) {
            translateX.value = Math.min(e.translationX * 0.35, 40);
          }
        })
        .onEnd((e) => {
          if (isOut && e.translationX < -56) {
            runOnJS(triggerSwipeReply)();
          } else if (!isOut && e.translationX > 56) {
            runOnJS(triggerSwipeReply)();
          }
          translateX.value = withSpring(0, { damping: 20, stiffness: 300 });
        }),
    [isOut, onSwipeReply, triggerSwipeReply, translateX]
  );

  const swipeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const bubble = (
    <View>
        <View
          style={[
            styles.bubble,
            isOut ? styles.bubbleOut : styles.bubbleIn,
            emojiOnly  && styles.bubbleEmoji,
            isImage && mediaUri && !imageFailed && styles.bubbleImage,
            highlighted && styles.bubbleHighlight,
          ]}
        >
          {quotedMessage ? (
            <WhatsAppQuotedReply
              quoted={quotedMessage}
              peerName={peerName}
              outbound={isOut}
              onPress={onQuotedPress}
            />
          ) : null}

          {/* ── Image ─────────────────────────────────────────────────── */}
          {showMedia && isImage && mediaUri && !imageFailed ? (
            <GHPressable
              onPress={() => onImagePress?.(mediaUri)}
              onLongPress={onLongPress}
              delayLongPress={300}
              style={styles.imagePressable}
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
              <View style={styles.imageMeta} pointerEvents="none">
                <View style={styles.imageMetaRow}>
                  <BubbleMetaContent {...metaProps} light />
                </View>
              </View>
            </GHPressable>
          ) : null}

          {/* ── Image that failed to load → fall back to a tappable chip ─ */}
          {showMedia && isImage && (imageFailed || !mediaUri) ? (
            <>
              <GHPressable
                style={styles.fileChip}
                onPress={() => mediaUri && onImagePress?.(mediaUri)}
                onLongPress={onLongPress}
                delayLongPress={300}
              >
                <Ionicons name="image" size={18} color={isOut ? '#075E54' : Colors.primary} />
                <Text style={styles.fileText} numberOfLines={1}>Tap to open image</Text>
              </GHPressable>
              <BubbleMetaRow {...metaProps} />
            </>
          ) : null}

          {/* ── Audio / voice note ────────────────────────────────────── */}
          {showMedia && !isImage && isAudio && mediaSource ? (
            <GHPressable onLongPress={onLongPress} delayLongPress={300}>
              <WhatsAppAudioBubble source={mediaSource} outbound={isOut} />
              <BubbleMetaRow {...metaProps} />
            </GHPressable>
          ) : null}

          {/* ── Video ─────────────────────────────────────────────────── */}
          {showMedia && !isImage && !isAudio && isVideo ? (
            <>
              <GHPressable
                style={styles.fileChip}
                onPress={() => mediaUri && onImagePress?.(mediaUri)}
                onLongPress={onLongPress}
                delayLongPress={300}
              >
                <Ionicons name="play-circle" size={22} color={isOut ? '#075E54' : Colors.primary} />
                <Text style={styles.fileText} numberOfLines={1}>{attachmentLabel}</Text>
              </GHPressable>
              <BubbleMetaRow {...metaProps} />
            </>
          ) : null}

          {/* ── File / document ───────────────────────────────────────── */}
          {showMedia && !isImage && !isAudio && !isVideo ? (
            <>
              <GHPressable
                style={styles.fileChip}
                onPress={() => mediaUri && onImagePress?.(mediaUri)}
                onLongPress={onLongPress}
                delayLongPress={300}
              >
                <Ionicons
                  name="document-attach"
                  size={18}
                  color={isOut ? '#075E54' : Colors.primary}
                />
                <Text style={styles.fileText} numberOfLines={1}>
                  {attachmentLabel}
                </Text>
              </GHPressable>
              <BubbleMetaRow {...metaProps} />
            </>
          ) : null}

          {/* ── Media placeholder without stored URL ──────────────────── */}
          {isOrphanPlaceholder ? (
            <View style={styles.orphanWrap}>
              <View style={styles.orphanChip}>
                <Ionicons
                  name={
                    /Video/i.test(bodyTrimmed) ? 'videocam-outline' :
                    /Audio|Voice/i.test(bodyTrimmed) ? 'mic-outline' :
                    /Image/i.test(bodyTrimmed) ? 'image-outline' :
                    'document-outline'
                  }
                  size={16}
                  color={Colors.textMuted}
                />
                <Text style={styles.orphanLabel}>
                  {/Video/i.test(bodyTrimmed) ? 'Video' :
                   /Audio|Voice/i.test(bodyTrimmed) ? 'Voice message' :
                   /Image/i.test(bodyTrimmed) ? 'Photo' :
                   'Attachment'}
                </Text>
              </View>
              <BubbleMetaRow {...metaProps} />
            </View>
          ) : null}

          {/* ── Emoji-only ────────────────────────────────────────────── */}
          {emojiOnly ? (
            <GHPressable onLongPress={onLongPress} delayLongPress={300}>
              <Text style={styles.emojiBody}>{body}</Text>
              <BubbleMetaRow {...metaProps} />
            </GHPressable>
          ) : null}

          {/* ── Plain text ────────────────────────────────────────────── */}
          {showTextBody ? (
            <GHPressable onLongPress={onLongPress} delayLongPress={300}>
              <View style={styles.textBodyWrap}>
                {/*
                  paddingBottom reserves a badge-height slot at the bottom of
                  the text so the badge never overlaps any text line.
                  The badge row uses a negative marginTop to pull back up into
                  that reserved space — no absolute positioning, no invisible
                  spacer text — works identically on iOS and Android.
                */}
                <Text style={[styles.body, isOut && styles.bodyOut, styles.bodyWithBadge]}>
                  {body}
                </Text>
                <View style={[styles.bodyBadgeRow, isOut && styles.bodyBadgeRowOut]} pointerEvents="none">
                  <Text style={[styles.time, isOut && styles.timeOut]}>{timeLabel}</Text>
                  {isOut ? <WhatsAppTicks deliveryStatus={message.delivery_status} /> : null}
                </View>
              </View>
            </GHPressable>
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
      </View>
  );

  return (
    <View style={[styles.wrapper, isOut ? styles.wrapperOut : styles.wrapperIn]}>
      <GestureDetector gesture={panGesture}>
        <Reanimated.View
          style={[isOut ? styles.alignOut : styles.alignIn, swipeStyle]}
        >
          {bubble}
        </Reanimated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: 'row',
    marginBottom: 2,
    width: '100%',
    alignSelf: 'stretch',
  },
  wrapperIn:  { justifyContent: 'flex-start' },
  wrapperOut: { justifyContent: 'flex-end' },
  alignIn:  { alignSelf: 'flex-start', maxWidth: '82%' },
  alignOut: { alignSelf: 'flex-end', maxWidth: '82%' },

  bubble: {
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

  imagePressable: { borderRadius: 6, overflow: 'hidden' },
  // Image
  image: { width: 240, height: 200, borderRadius: 6, backgroundColor: Colors.border },
  imageLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageMeta: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  imageMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },

  // File
  fileChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 8, backgroundColor: 'rgba(0,0,0,0.04)', borderRadius: 8, marginBottom: 4,
  },
  fileText: { flexShrink: 1, fontSize: 13, color: Colors.text },
  orphanWrap: { minWidth: 140 },
  orphanChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2,
    marginBottom: 2,
  },
  orphanLabel: { fontSize: 13, color: Colors.textMuted, fontStyle: 'italic' },

  // Emoji
  emojiBody: { fontSize: 40, lineHeight: 46, textAlign: 'center', includeFontPadding: false },

  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 2,
    marginTop: 2,
    alignSelf: 'flex-end',
  },

  // ── Plain text body ──────────────────────────────────────────────────────
  textBodyWrap: {},
  body: {
    fontSize: 15,
    color: Colors.text,
    lineHeight: 21,
    includeFontPadding: false,
  },
  // Adds bottom padding equal to the badge height so the badge never overlaps
  // any text line when pulled up with a negative marginTop.
  bodyWithBadge: {
    paddingBottom: 16,
  },
  bodyOut: { color: Colors.text },
  // Badge row sits directly below the Text in document flow but uses a negative
  // marginTop to visually occupy the reserved paddingBottom space.
  bodyBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    alignSelf: 'flex-end',
    gap: 3,
    marginTop: -15,
  },
  bodyBadgeRowOut: {
    // outgoing badge needs a little extra right clearance for the ticks
    paddingRight: 1,
  },

  time:      { fontSize: 11, color: Colors.textMuted, lineHeight: 15 },
  timeOut:   { color: '#7E9B7A' },
  timeLight: { color: '#fff', fontWeight: '500' },

  caption: { fontSize: 14, color: Colors.text, lineHeight: 19, paddingHorizontal: 4, paddingBottom: 2 },
  failHint: { fontSize: 11, color: FAIL_RED, lineHeight: 15, marginTop: 3 },
  advice:   { fontSize: 11, color: '#B45309', lineHeight: 15, marginTop: 2 },
});
