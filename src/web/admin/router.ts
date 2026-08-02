/**
 * Navigation du panneau d'administration.
 *
 * Le panneau tient en une seule page. Changer de vue ne recharge rien : un
 * rechargement rouvrirait le WebSocket, et le compteur repartirait de zéro à
 * l'écran le temps du premier instantané. Le hash porte donc l'état de
 * navigation, ce qui a l'avantage secondaire de rendre une vue partageable et
 * de faire fonctionner le bouton « précédent ».
 *
 * **La liste est close, et c'est la seule garantie qui compte ici.** Le hash
 * vient de l'URL, donc d'un lien, donc de n'importe où. `viewFromHash` ne
 * renvoie jamais autre chose qu'un identifiant de cette liste : aucune valeur
 * extérieure ne peut ainsi servir à composer un sélecteur ni finir dans le DOM.
 *
 * La liste s'allonge à chaque lot de la PR C plutôt que d'annoncer d'emblée les
 * huit vues : une entrée de navigation qui mène à une section inexistante est
 * un défaut, et chaque lot doit rester utilisable seul.
 */

/** Vues du panneau, dans l'ordre de la navigation latérale. */
export const ADMIN_VIEWS = [
  'dashboard',
  'rewards',
  'appearance',
  'twitch',
  'settings',
  'transfer',
] as const;

export type AdminViewId = (typeof ADMIN_VIEWS)[number];

/**
 * Vues dont le contenu est piloté par des descripteurs de champs.
 *
 * Les autres se câblent à la main : le tableau de bord n'a aucun réglage, et
 * l'import/export manipule un fichier entier, pas des champs.
 */
export const FIELD_VIEWS = ['rewards', 'appearance', 'twitch', 'settings'] as const;

export type FieldViewId = (typeof FIELD_VIEWS)[number];

/** Vue ouverte à défaut : celle qui a du sens sans avoir rien demandé. */
export const DEFAULT_VIEW: AdminViewId = 'dashboard';

/** Libellés de la navigation. Séparés des identifiants, qui sont techniques. */
export const VIEW_LABELS: Readonly<Record<AdminViewId, string>> = {
  dashboard: 'Tableau de bord',
  rewards: 'Barème',
  appearance: 'Apparence',
  twitch: 'Twitch',
  settings: 'Paramètres',
  transfer: 'Import / export',
};

function isAdminView(value: string): value is AdminViewId {
  return (ADMIN_VIEWS as readonly string[]).includes(value);
}

/**
 * Traduit un hash d'URL en vue.
 *
 * Tolérante sur la forme — dièse facultatif, casse indifférente, espaces
 * ignorés — et stricte sur le fond : tout ce qui ne correspond pas exactement
 * à une vue connue ramène à la vue par défaut. Ne lève jamais : une URL fautive
 * doit ouvrir le panneau, pas une page blanche.
 */
export function viewFromHash(hash: string): AdminViewId {
  const candidate = hash.trim().replace(/^#/, '').toLowerCase();
  return isAdminView(candidate) ? candidate : DEFAULT_VIEW;
}

/** Hash à écrire dans un lien de navigation. */
export function hashForView(view: AdminViewId): string {
  return `#${view}`;
}
