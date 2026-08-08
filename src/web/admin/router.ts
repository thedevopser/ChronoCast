export const ADMIN_VIEWS = [
  'dashboard',
  'rewards',
  'appearance',
  'twitch',
  'history',
  'logs',
  'settings',
  'transfer',
  'about',
] as const;

export type AdminViewId = (typeof ADMIN_VIEWS)[number];

export const FIELD_VIEWS = ['rewards', 'appearance', 'twitch', 'settings'] as const;

export type FieldViewId = (typeof FIELD_VIEWS)[number];

export const DEFAULT_VIEW: AdminViewId = 'dashboard';

export const VIEW_LABELS: Readonly<Record<AdminViewId, string>> = {
  dashboard: 'Tableau de bord',
  rewards: 'Barème',
  appearance: 'Apparence',
  twitch: 'Twitch',
  history: 'Historique',
  logs: 'Journaux',
  settings: 'Paramètres',
  transfer: 'Import / export',
  about: 'À propos',
};

function isAdminView(value: string): value is AdminViewId {
  return (ADMIN_VIEWS as readonly string[]).includes(value);
}

export function viewFromHash(hash: string): AdminViewId {
  const candidate = hash.trim().replace(/^#/, '').toLowerCase();
  return isAdminView(candidate) ? candidate : DEFAULT_VIEW;
}

export function hashForView(view: AdminViewId): string {
  return `#${view}`;
}
