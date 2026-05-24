import { supabase } from './supabase';

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  console.log('[api] session token present:', !!token, '| BASE_URL:', BASE_URL);
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function fetchWithTimeout(input: string, init: RequestInit, ms = 30000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  console.log('[api] GET', url.toString());
  const res = await fetchWithTimeout(url.toString(), { headers: await authHeaders() });
  if (!res.ok) {
    let msg = `GET ${path} failed: ${res.status}`;
    try { const b = await res.json(); if (b?.error) msg = b.error; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  console.log('[api] POST', `${BASE_URL}${path}`);
  const res = await fetchWithTimeout(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return res.json();
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`);
  return res.json();
}

// Gmail
export type GmailFolder = 'inbox' | 'sent' | 'drafts';

export interface GmailThreadListItem {
  id: string;
  snippet: string;
  subject: string;
  from: string;
  date: string;
  historyId?: string;
  draftId?: string;
  /** True if any message in the thread has Gmail's UNREAD label. */
  unread?: boolean;
  /** True if STARRED is on any message in the thread. */
  starred?: boolean;
  /** True if any message's Content-Type starts with multipart/mixed. */
  hasAttachments?: boolean;
  /** Folder-state labels (INBOX/SENT/etc.) and STARRED are stripped server-side. */
  labelIds?: string[];
}

export interface GmailLabel {
  id: string;
  name: string;
  type: 'system' | 'user';
  surfaced: boolean;
  isSystem: boolean;
  isCategory: boolean;
  color?: { backgroundColor?: string; textColor?: string };
}

export interface GmailAttachment {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  body: string;
  bodyHtml: string;
  messageIdHeader?: string;
  attachments: GmailAttachment[];
}

export interface GmailSendBody {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  textBody: string;
  threadId?: string;
  inReplyToMessageId?: string;
}

export const gmailApi = {
  listThreads: (
    folder: GmailFolder = 'inbox',
    opts?: { pageToken?: string; search?: string; maxResults?: number; labelId?: string }
  ) => {
    const params: Record<string, string> = { folder };
    if (opts?.pageToken) params.pageToken = opts.pageToken;
    if (opts?.search) params.search = opts.search;
    if (opts?.maxResults) params.maxResults = String(opts.maxResults);
    if (opts?.labelId) params.labelId = opts.labelId;
    return get<{ folder: GmailFolder; threads: GmailThreadListItem[]; nextPageToken?: string }>(
      '/api/gmail/threads',
      params
    );
  },
  getThread: (id: string) =>
    get<{ threadId: string; messages: GmailMessage[]; labelIds?: string[] }>(`/api/gmail/threads/${id}`),
  listLabels: () => get<{ labels: GmailLabel[] }>('/api/gmail/labels'),
  createLabel: (name: string) =>
    post<{ label: GmailLabel }>('/api/gmail/labels', { name }),
  modifyThreadLabels: (threadId: string, changes: { add?: string[]; remove?: string[] }) =>
    post<{ threadId: string; labelIds: string[] }>(
      `/api/gmail/threads/${encodeURIComponent(threadId)}/labels`,
      changes
    ),
  /** Apply the same add/remove to many thread ids. Bounded server-side. */
  batchModifyThreads: (threadIds: string[], changes: { add?: string[]; remove?: string[] }) =>
    post<{ requested: number; succeeded: number; failed: { threadId: string; error: string }[] }>(
      '/api/gmail/threads/batch-modify',
      { threadIds, ...changes }
    ),
  /** Thread total + unread per label/folder. */
  folderCounts: (ids: string[]) =>
    get<{ counts: Record<string, { total: number; unread: number }> }>(
      '/api/gmail/folder-counts',
      { ids: ids.join(',') }
    ),
  send: (body: GmailSendBody) => post<{ id: string; threadId: string }>('/api/gmail/send', body),
  getContacts: () =>
    get<{ contacts: Array<{ email: string; displayName?: string }>; hint?: string }>('/api/gmail/contacts'),
  getGoogleToken: () =>
    get<{ accessToken: string }>('/api/gmail/token'),
  attachmentUrl: (messageId: string, attachmentId: string, filename: string, mimeType: string) => {
    const p = new URLSearchParams({ messageId, attachmentId, filename, mimeType });
    return `${BASE_URL}/api/gmail/attachment?${p.toString()}`;
  },
  saveDraft: (data: { to?: string; cc?: string; bcc?: string; subject?: string; textBody?: string; draftId?: string; threadId?: string }) =>
    post<{ draftId: string; messageId?: string; threadId?: string }>('/api/gmail/drafts', data),
  getDraft: (draftId: string) =>
    get<{ draftId: string; messageId?: string; threadId?: string; to: string; cc: string; bcc: string; subject: string; textBody: string; attachments?: Array<{ attachmentId: string; filename: string; mimeType: string; size: number; messageId: string }> }>(
      '/api/gmail/drafts', { draftId }
    ),
  deleteDraft: async (draftId: string) => {
    const headers = await authHeaders();
    const res = await fetch(`${BASE_URL}/api/gmail/drafts?draftId=${encodeURIComponent(draftId)}`, {
      method: 'DELETE',
      headers,
    });
    if (!res.ok) throw new Error(`DELETE draft failed: ${res.status}`);
    return res.json() as Promise<{ ok: boolean }>;
  },
};

// CRM
export const crmApi = {
  listLeads: (type?: string) => get<{ leads: any[] }>('/api/crm/leads', type ? { lead_type: type } : undefined),
  getLead: (id: string) => get<any>(`/api/crm/leads/${id}`),
  createLead: (data: any) => post('/api/crm/leads', data),
  updateLead: (id: string, data: any) => post(`/api/crm/leads/${id}`, data),
  deleteLead: (id: string) => del(`/api/crm/leads/${id}`),
  addInteraction: (leadId: string, data: any) => post(`/api/crm/leads/${leadId}/interactions`, data),
};

// Calls
export const callsApi = {
  list: () => get<{ logs: any[] }>('/api/calls'),
  transcribe: (callLogId: string) => post<any>('/api/calls/transcribe', { callLogId }),
  // `agentPhone` is this device's phone (in E.164) — required so the Exotel
  // connect webhook can match the right pending row when this user calls in.
  makeCall: (to: string, agentPhone?: string) =>
    post<{ ok: boolean; id: string }>('/api/calls', { to, agentPhone }),
  refresh: (id: string) => post<{ ok: boolean; exotelStatus?: string; mappedStatus?: string; hasRecording?: boolean }>('/api/calls/refresh', { id }),
  recordingUrl: (recordingSid: string) => `${BASE_URL}/api/calls/recording/${encodeURIComponent(recordingSid)}`,
};

// SMS
export const smsApi = {
  listConversations: () => get<{ conversations: any[] }>('/api/sms/conversations'),
  getMessages: (peer: string) => get<{ messages: any[] }>('/api/sms/messages', { peer }),
  send: (to: string, body: string) => post('/api/sms/send', { to, body }),
};

// WhatsApp
export const whatsappApi = {
  listConversations: () => get<{ conversations: any[] }>('/api/whatsapp/conversations'),
  getMessages: (peer: string) => get<{ messages: any[] }>('/api/whatsapp/messages', { peer }),
  send: (to: string, body: string) => post('/api/whatsapp/send', { to, body }),
};

// Calendar
export type CalendarSendUpdates = 'all' | 'externalOnly' | 'none';

export type CalendarEventInput = {
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: { email: string }[];
  /** If true, Google Calendar creates a Google Meet link on the event. */
  addMeet?: boolean;
  /** 'all' = email everyone, 'externalOnly' = only non-owned-domain, 'none' = silent. */
  sendUpdates?: CalendarSendUpdates;
};

export type CalendarEventResponse = {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: { email?: string; displayName?: string; responseStatus?: string }[];
  htmlLink?: string;
  hangoutLink?: string;
};

export const calendarApi = {
  listEvents: (timeMin?: string, timeMax?: string) =>
    get<{ events: CalendarEventResponse[] }>('/api/calendar/events', {
      ...(timeMin ? { timeMin } : {}),
      ...(timeMax ? { timeMax } : {}),
    }),
  createEvent: (data: CalendarEventInput) =>
    post<{ event: CalendarEventResponse }>('/api/calendar/events', data),
  updateEvent: async (id: string, data: Partial<CalendarEventInput>) => {
    const headers = await authHeaders();
    const res = await fetch(`${BASE_URL}/api/calendar/events/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      let msg = `PATCH event failed: ${res.status}`;
      try { const b = await res.json(); if (b?.error) msg = b.error; } catch {}
      throw new Error(msg);
    }
    return res.json() as Promise<{ event: CalendarEventResponse }>;
  },
  deleteEvent: async (id: string, opts?: { sendUpdates?: CalendarSendUpdates }) => {
    const headers = await authHeaders();
    const qs = opts?.sendUpdates ? `?sendUpdates=${encodeURIComponent(opts.sendUpdates)}` : '';
    const res = await fetch(`${BASE_URL}/api/calendar/events/${encodeURIComponent(id)}${qs}`, {
      method: 'DELETE',
      headers,
    });
    if (!res.ok) {
      let msg = `DELETE event failed: ${res.status}`;
      try { const b = await res.json(); if (b?.error) msg = b.error; } catch {}
      throw new Error(msg);
    }
    return res.json() as Promise<{ ok: boolean }>;
  },
};

// Meetings
export const meetingsApi = {
  list: () => get<{ meetings: any[] }>('/api/meetings'),
  sync: () => post('/api/meetings/sync'),
  sendSummary: (meetingId: string, email: string) =>
    post('/api/meetings/send-summary', { meetingId, email }),
};

// Drive
export const driveApi = {
  listFiles: (parentId?: string, opts?: { pageToken?: string; search?: string; pageSize?: number }) => {
    const params: Record<string, string> = { parent: parentId ?? 'root' };
    if (opts?.pageToken) params.pageToken = opts.pageToken;
    if (opts?.search) params.search = opts.search;
    if (opts?.pageSize) params.pageSize = String(opts.pageSize);
    return get<{ files: any[]; nextPageToken?: string }>('/api/drive/files', params);
  },
  uploadFile: async (formData: FormData) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const res = await fetchWithTimeout(`${BASE_URL}/api/drive/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    }, 60000);
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    return res.json();
  },
};

// Forms
export type FormListRow = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  formTitle?: string | null;
};

export const formsApi = {
  list: (opts?: { pageToken?: string; search?: string; pageSize?: number }) => {
    const params: Record<string, string> = {};
    if (opts?.pageToken) params.pageToken = opts.pageToken;
    if (opts?.search) params.search = opts.search;
    if (opts?.pageSize) params.pageSize = String(opts.pageSize);
    return get<{ forms: FormListRow[]; nextPageToken?: string }>('/api/forms', params);
  },
  create: (title: string) => post<{ formId: string; responderUri?: string }>('/api/forms', { title }),
  get: (id: string) => get<Record<string, unknown>>(`/api/forms/${encodeURIComponent(id)}`),
  save: (id: string, state: unknown) =>
    post<{ ok: boolean; form?: Record<string, unknown>; editorState?: unknown; noChanges?: boolean; error?: string; message?: string }>(
      `/api/forms/${encodeURIComponent(id)}/save`,
      { state }
    ),
};

// Me
export type MeMailbox = {
  sessionEmail: string | null;
  displayUsername: string | null;
  role: string;
  restrictedFeatures: string[];
  mailboxOwnerId: string | null;
  mailboxEmail: string | null;
  hasStoredMailbox: boolean;
};

export const meApi = {
  mailbox: () => get<MeMailbox>('/api/me/mailbox'),
};

// Mailbox session sync — persists the Google refresh token server-side
// so Gmail/Drive/Calendar keep working without re-consent.
// Mobile passes the provider tokens explicitly because Bearer-authed
// requests have no cookie session for the backend to read from.
export const mailboxApi = {
  registerSession: (data?: { providerRefreshToken?: string; providerAccessToken?: string }) =>
    post<{ ok?: boolean; skipped?: boolean; reason?: string; error?: string }>(
      '/api/mailbox/register-session',
      data ?? {}
    ),
};

// Broadcast
export type BroadcastEmailPayload = {
  recipients: string[];
  subject: string;
  textBody: string;
  attachments?: Array<{ filename: string; mimeType: string; base64Data: string }>;
};
export type BroadcastEmailResult = {
  sent: number;
  failed: Array<{ email: string; error: string }>;
  recipients: number;
};

export const broadcastApi = {
  sendEmail: (data: BroadcastEmailPayload) =>
    post<BroadcastEmailResult>('/api/broadcast/email', data),
  sendSms: (data: { recipients: string[]; text: string }) =>
    post<{ sent: number; failed: Array<{ phone: string; error: string }> }>('/api/broadcast/sms', data),
  sendWhatsApp: (data: { recipients: string[]; text: string }) =>
    post<{ sent: number; failed: Array<{ phone: string; error: string }> }>('/api/broadcast/whatsapp', data),
};

// Mail merge
export type MailMergeRow = {
  email: string;
  fields: Record<string, string>;
};
export type MailMergeParseResult = {
  rows: MailMergeRow[];
  columns: string[];
  headerLabels: string[];
  skipped?: number;
  truncated?: boolean;
  maxRows?: number;
  samplePreview?: { subject: string; body: string };
};
export type MailMergeSendPayload = {
  subjectTemplate: string;
  bodyTemplate: string;
  rows: MailMergeRow[];
  attachments?: Array<{ filename: string; mimeType: string; base64Data: string }>;
};
export type MailMergeSendResult = {
  sent: number;
  failed: Array<{ email: string; error: string }>;
  recipients: number;
};

export const mailMergeApi = {
  parseFile: async (uri: string, filename: string, mimeType: string) => {
    const headers = await authHeaders();
    delete (headers as Record<string, string>)['Content-Type']; // let fetch set multipart boundary
    const form = new FormData();
    form.append('file', { uri, name: filename, type: mimeType } as any);
    const res = await fetchWithTimeout(`${BASE_URL}/api/broadcast/parse-mail-merge`, {
      method: 'POST',
      headers,
      body: form,
    }, 60000);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error ?? `Parse failed: ${res.status}`);
    return data as MailMergeParseResult;
  },
  send: (data: MailMergeSendPayload) =>
    post<MailMergeSendResult>('/api/broadcast/mail-merge', data),
};

// Admin
export const adminApi = {
  listTeam: () => get<{ members: any[] }>('/api/admin/team'),
  createMember: (data: any) => post('/api/admin/team', data),
  updateMember: (id: string, data: any) => post(`/api/admin/team/${id}`, data),
  deleteMember: (id: string) => del(`/api/admin/team/${id}`),
};

// Dashboard / Extraction
export const extractApi = {
  listJobs: () => get<{ jobs: any[] }>('/api/jobs'),
  startExtraction: (data: any) => post('/api/extract', data),
  getResults: (jobId: string) => get<{ contacts: any[] }>(`/api/jobs/${jobId}/results`),
  exportCsv: (jobId: string) => get<any>(`/api/jobs/${jobId}/export`),
};
