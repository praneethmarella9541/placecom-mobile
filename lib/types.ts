export type UserRole = 'admin' | 'staff' | 'committee';

export interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  role: UserRole;
  restricted_features: string[];
  mobile_phone: string | null;
  exotel_virtual_number: string | null;
}

export type LeadStage =
  | 'Awareness'
  | 'Engagement'
  | 'Conversion'
  | 'Retention'
  | 'Relationship Mgt'
  | 'JD Expected'
  | 'JD Received'
  | 'Drive Scheduled';

export type LeadType = 'New Lead' | 'Regular Recruiter';
export type LeadScore = 'Hot' | 'Warm' | 'Cold';

export interface Lead {
  id: string;
  company_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  stage: LeadStage;
  score: LeadScore | null;
  lead_type: LeadType;
  staff_name: string | null;
  jd_count: number;
  created_at: string;
  updated_at: string;
}

export interface LeadInteraction {
  id: string;
  lead_id: string;
  type: 'Call' | 'Email' | 'Meeting' | 'Note';
  notes: string | null;
  created_at: string;
  user_id: string;
}

export interface CallLog {
  id: string;
  call_sid: string;
  to_number: string;
  from_number: string;
  agent_number: string | null;
  company_name: string | null;
  notes: string | null;
  status: string;
  duration_seconds: number | null;
  started_at: string | null;
  ended_at: string | null;
  recording_sid: string | null;
  recording_duration_seconds: number | null;
  transcript: string | null;
  transcript_segments: { speaker?: string; text: string }[] | null;
  created_at: string;
  /** Derived server-side: 'incoming' for inbound, 'outbound' for outgoing. */
  direction?: 'incoming' | 'outbound';
  /** Derived server-side: the other party's number (never our own). */
  peer_number?: string | null;
}

export interface SmsMessage {
  id: string;
  user_id: string;
  direction: 'inbound' | 'outbound';
  peer_e164: string;
  from_addr: string;
  to_addr: string;
  body: string;
  message_sid: string;
  created_at: string;
}

export interface WhatsAppMessage {
  id: string;
  user_id: string;
  direction: 'inbound' | 'outbound';
  peer_e164: string;
  from_addr: string;
  to_addr: string;
  body: string;
  message_sid: string;
  num_media: number;
  delivery_status?: string | null;
  media_url?: string | null;
  content_type?: string | null;
  created_at: string;
}

export interface MeetingRecording {
  id: string;
  meeting_url: string | null;
  fireflies_id: string | null;
  status: string;
  transcript: string | null;
  summary: string | null;
  user_id: string;
  created_at: string;
}

export interface EmailThread {
  id: string;
  threadId: string;
  subject: string;
  snippet: string;
  from: string;
  date: string;
  unread: boolean;
}

export interface EmailMessage {
  id: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  body: string;
  attachments: EmailAttachment[];
}

export interface EmailAttachment {
  filename: string;
  mimeType: string;
  attachmentId: string;
  size: number;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string | null;
  modifiedTime: string;
  webViewLink?: string | null;
  starred?: boolean;
  shared?: boolean;
  thumbnailLink?: string | null;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  description?: string;
  attendees?: { email?: string; displayName?: string; responseStatus?: string }[];
  location?: string;
  htmlLink?: string;
  hangoutLink?: string;
  colorId?: string;
  recurrence?: string[];
}

export interface TeamMember {
  id: string;
  email: string;
  display_name: string | null;
  role: UserRole;
  restricted_features: string[];
  created_at: string;
}

export interface ExtractionJob {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  email_count: number;
  extracted_count: number;
  total_tokens: number;
  estimated_cost: number;
  created_at: string;
}

export interface ExtractedContact {
  id: string;
  job_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  subject: string | null;
  from_email: string | null;
}
