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

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { headers: await authHeaders() });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
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
export const gmailApi = {
  listThreads: (folder = 'INBOX') => get<{ threads: any[] }>('/api/fetch-emails', { folder }),
  getThread: (id: string) => get<any>(`/api/gmail/thread/${id}`),
  send: (body: { to: string; subject: string; body: string; replyToMessageId?: string; attachments?: any[] }) =>
    post('/api/gmail/send', body),
  markRead: (messageId: string) => post('/api/gmail/mark-read', { messageId }),
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
  list: () => get<{ calls: any[] }>('/api/calls'),
  getRecording: (callSid: string) => get<any>(`/api/calls/recording/${callSid}`),
  getTranscript: (callLogId: string) => get<any>(`/api/calls/transcript/${callLogId}`),
  makeCall: (to: string) => post('/api/calls', { to }),
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
export const calendarApi = {
  listEvents: (timeMin?: string, timeMax?: string) =>
    get<{ events: any[] }>('/api/calendar/events', {
      ...(timeMin ? { timeMin } : {}),
      ...(timeMax ? { timeMax } : {}),
    }),
  createEvent: (data: any) => post('/api/calendar/events', data),
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
  listFiles: (folderId?: string) =>
    get<{ files: any[] }>('/api/drive/files', folderId ? { folderId } : undefined),
  uploadFile: (formData: FormData) =>
    fetch(`${BASE_URL}/api/drive/upload`, {
      method: 'POST',
      body: formData,
    }).then((r) => r.json()),
  downloadFile: (fileId: string) => get<any>(`/api/drive/download/${fileId}`),
};

// Forms
export const formsApi = {
  list: () => get<{ forms: any[] }>('/api/forms'),
  create: (data: any) => post('/api/forms', data),
  update: (id: string, data: any) => post(`/api/forms/${id}`, data),
};

// Broadcast
export const broadcastApi = {
  sendEmail: (data: any) => post('/api/broadcast/email', data),
  sendSms: (data: any) => post('/api/broadcast/sms', data),
  sendWhatsApp: (data: any) => post('/api/broadcast/whatsapp', data),
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
