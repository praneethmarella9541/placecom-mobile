/** Label for outbound bubble / message info (matches web Placecom). */
export function formatWhatsAppDeliveryLabel(
  deliveryStatus: string | null | undefined
): string | null {
  const s = (deliveryStatus ?? '').trim();
  if (!s) return null;
  if (s === 'sent') return 'Sent to WhatsApp';
  if (s === 'delivered') return 'Delivered';
  if (s === 'read') return 'Read';
  if (s.startsWith('failed')) {
    const detail = s.replace(/^failed:\s*/i, '').trim();
    return detail ? `Not delivered — ${detail}` : 'Not delivered';
  }
  return s;
}

export function isWhatsAppDeliveryFailed(deliveryStatus: string | null | undefined): boolean {
  return (deliveryStatus ?? '').toLowerCase().startsWith('failed');
}

export function getDeliveryFailureAdvice(
  deliveryStatus: string | null | undefined
): string | null {
  const s = (deliveryStatus ?? '').toLowerCase();
  if (!s.startsWith('failed')) return null;

  if (s.includes('130472') || s.includes('experiment')) {
    return (
      'This user may need to message you first to open a 24-hour session. ' +
      'Try SMS or a call, then have them reply on WhatsApp.'
    );
  }
  if (s.includes('131049') || s.includes('message limit')) {
    return 'Too many marketing messages to this number. Wait 24 hours or use SMS/call.';
  }
  if (s.includes('131021') || s.includes('not on whatsapp')) {
    return 'This number may not be on WhatsApp. Confirm the number with your contact.';
  }
  if (s.includes('131047') || s.includes('24 hour')) {
    return 'Session expired. Send the approved template again, then wait for a reply.';
  }
  return null;
}

export function showWhatsAppFailureDetail(deliveryStatus: string | null | undefined): boolean {
  return isWhatsAppDeliveryFailed(deliveryStatus);
}
