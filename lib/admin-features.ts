/** Feature keys for admin access groups — aligned with placecom web. */

export const GROUP_MANAGEABLE_FEATURES = [
  'inbox',
  'drive',
  'forms',
  'broadcasting',
  'dashboard',
  'calendar',
  'whatsapp',
] as const;

export type GroupManageableFeature = (typeof GROUP_MANAGEABLE_FEATURES)[number];

export const FEATURE_LABELS: Record<GroupManageableFeature, string> = {
  inbox: 'Mail',
  drive: 'Drive',
  forms: 'Forms',
  broadcasting: 'Broadcasting',
  dashboard: 'Extraction',
  calendar: 'Calendar',
  whatsapp: 'WhatsApp',
};
