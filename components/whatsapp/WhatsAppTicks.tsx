import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getWhatsAppTickLevel } from '../../lib/whatsapp-tick-level';
import { formatWhatsAppDeliveryLabel } from '../../lib/whatsapp-delivery';

const GREY = '#8696A0';
const BLUE = '#53BDEB';
const FAIL = '#EF4444';

/** Overlapping double checkmarks (WhatsApp-style). */
function DoubleCheck({ color }: { color: string }) {
  return (
    <View style={styles.doubleWrap}>
      <Ionicons name="checkmark" size={15} color={color} style={styles.tickBack} />
      <Ionicons name="checkmark" size={15} color={color} style={styles.tickFront} />
    </View>
  );
}

function SingleCheck({ color }: { color: string }) {
  return <Ionicons name="checkmark" size={15} color={color} />;
}

export function WhatsAppTicks({
  deliveryStatus,
  light = false,
}: {
  deliveryStatus?: string | null;
  light?: boolean;
}) {
  const level = getWhatsAppTickLevel(deliveryStatus);
  const title = formatWhatsAppDeliveryLabel(deliveryStatus) ?? undefined;
  const grey = light ? 'rgba(255,255,255,0.85)' : GREY;
  const blue = light ? '#B8E7FF' : BLUE;

  if (level === 'failed') {
    return (
      <Ionicons
        name="alert-circle"
        size={14}
        color={light ? '#FCA5A5' : FAIL}
        accessibilityLabel={title}
      />
    );
  }

  if (level === 'pending') {
    return (
      <Ionicons
        name="time-outline"
        size={13}
        color={grey}
        accessibilityLabel={title ?? 'Sending'}
      />
    );
  }

  if (level === 'read') {
    return <DoubleCheck color={blue} />;
  }

  if (level === 'delivered') {
    return <DoubleCheck color={grey} />;
  }

  // sent
  return <SingleCheck color={grey} />;
}

export function DeliveryFailureHint({ deliveryStatus }: { deliveryStatus?: string | null }) {
  const label = formatWhatsAppDeliveryLabel(deliveryStatus);
  if (!label?.toLowerCase().includes('not delivered')) return null;
  return (
    <Text style={styles.failHint} numberOfLines={3}>
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  doubleWrap: {
    width: 20,
    height: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  tickBack: {
    position: 'absolute',
    left: 0,
  },
  tickFront: {
    position: 'absolute',
    left: 5,
  },
  failHint: { fontSize: 11, color: FAIL, marginTop: 4 },
});
