// Mirrors placecom (web) lib/feature-access.ts — keep FEATURE_LABELS and
// GROUP_MANAGEABLE_FEATURES in sync with the web app.

export type FeatureKey =
  | 'inbox'
  | 'drive'
  | 'forms'
  | 'broadcasting'
  | 'dashboard'
  | 'crm'
  | 'calendar'
  | 'meetings'
  | 'sms'
  | 'whatsapp';

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  inbox: 'Mail',
  drive: 'Drive',
  forms: 'Forms',
  broadcasting: 'Broadcasting',
  dashboard: 'Extraction',
  crm: 'CRM',
  calendar: 'Calendar',
  meetings: 'Meetings',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
};

/** Features shown in admin access-group checklists. */
export const GROUP_MANAGEABLE_FEATURES: FeatureKey[] = [
  'inbox',
  'drive',
  'forms',
  'broadcasting',
  'calendar',
  'whatsapp',
];
