import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds % 60);
  const m = Math.floor(seconds / 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

type Props = {
  source: { uri: string; headers?: Record<string, string> };
  outbound?: boolean;
};

export function WhatsAppAudioBubble({ source, outbound }: Props) {
  const player = useAudioPlayer(source);
  const status = useAudioPlayerStatus(player);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
  }, []);

  const playing = status.playing;
  const duration = status.duration ?? 0;
  const position = status.currentTime ?? 0;
  const progress = duration > 0 ? Math.min(1, position / duration) : 0;

  const tint = outbound ? '#075E54' : '#25D366';

  function toggle() {
    if (playing) {
      player.pause();
    } else {
      // Restart from the beginning if it finished.
      if (duration > 0 && position >= duration - 0.25) {
        player.seekTo(0);
      }
      player.play();
    }
  }

  return (
    <View style={styles.row}>
      <TouchableOpacity style={[styles.playBtn, { backgroundColor: tint }]} onPress={toggle}>
        <Ionicons name={playing ? 'pause' : 'play'} size={18} color="#fff" />
      </TouchableOpacity>
      <View style={styles.body}>
        <View style={styles.track}>
          <View style={[styles.trackFill, { width: `${progress * 100}%`, backgroundColor: tint }]} />
          <View
            style={[
              styles.knob,
              { left: `${progress * 100}%`, backgroundColor: tint },
            ]}
          />
        </View>
        <Text style={styles.time}>
          {status.isLoaded
            ? fmt(position > 0 ? position : duration)
            : 'Loading…'}
        </Text>
      </View>
      <Ionicons
        name="mic"
        size={16}
        color={outbound ? '#7E9B7A' : '#8696A0'}
        style={styles.micIcon}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 200,
    paddingVertical: 2,
  },
  playBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 4, justifyContent: 'center' },
  track: {
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0.15)',
    justifyContent: 'center',
  },
  trackFill: {
    position: 'absolute',
    left: 0,
    height: 3,
    borderRadius: 2,
  },
  knob: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    marginLeft: -5,
  },
  time: { fontSize: 11, color: '#54656F' },
  micIcon: { alignSelf: 'flex-end', marginBottom: 2 },
});
