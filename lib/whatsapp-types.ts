export type WhatsAppConversation = {
  peer_e164: string;
  last_body: string | null;
  last_at: string;
  last_dir?: string;
  last_message?: string | null;
  last_message_at?: string | null;
  unread_count?: number;
};

export type WhatsAppMessage = {
  id: string;
  direction: 'inbound' | 'outbound' | string;
  peer_e164?: string;
  from_addr?: string | null;
  to_addr?: string | null;
  body: string | null;
  message_sid?: string | null;
  num_media?: number;
  delivery_status?: string | null;
  media_url?: string | null;
  content_type?: string | null;
  created_at: string;
  reply_to_id?: string | null;
  is_starred?: boolean;
  is_pinned?: boolean;
};

export type WhatsAppSendPayload = {
  messageType: string;
  text?: string;
  mediaUrl?: string;
  mediaCaption?: string;
  mediaFilename?: string;
  replyToId?: string;
};

export type WhatsAppStatus = {
  provider?: string;
  sendConfigured?: boolean;
  businessLine?: string | null;
  lineError?: string | null;
  defaultTemplate?: {
    name: string;
    languageCode: string;
    bodyParamCount: number;
    previewExample?: string;
  };
  suggestedInboundWebhookUrl?: string | null;
  migrationHint?: string;
};
