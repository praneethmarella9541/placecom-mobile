export type UserRole = 'admin' | 'staff' | 'committee';

export interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  role: UserRole;
  restricted_features: string[];
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
  company: string | null;
  notes: string | null;
  status: string;
  duration: number | null;
  recording_sid: string | null;
  recording_duration: number | null;
  created_at: string;
}

export interface CallTranscript {
  id: string;
  call_log_id: string;
  transcript: string;
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
  size: string | null;
  modifiedTime: string;
  parents: string[];
  webViewLink: string | null;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  description?: string;
  attendees?: { email: string; displayName?: string }[];
  location?: string;
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
