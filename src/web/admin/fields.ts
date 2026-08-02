/**
 * Descripteurs des champs du panneau.
 *
 * Une table, et non du code : chaque réglage du schéma y est décrit une fois —
 * son chemin, son genre, ses bornes, son libellé — et `form-binding.ts` fait le
 * reste. Ajouter un réglage revient donc à ajouter une ligne ici et un champ
 * dans le gabarit, jamais à écrire une nouvelle lecture ou une nouvelle
 * comparaison.
 *
 * **Les bornes recopient celles de `core/config/schema.ts`.** Elles ne s'y
 * substituent pas : Zod reste le juge, et refusera de toute façon. Elles
 * servent à nommer la faute sous le champ plutôt qu'à renvoyer un « 400 »
 * générique après un aller-retour réseau. `tests/unit/web/admin/fields.test.ts`
 * vérifie qu'elles laissent au moins passer la valeur par défaut.
 *
 * **Le contenu de cette table est un engagement produit.** L'exigence est
 * « aucune valeur métier codée en dur, tout est configurable depuis le panneau ».
 * Le même fichier de test l'impose : chaque feuille de la configuration doit
 * être liée ici, ou écartée dans `UNBOUND_PATHS` avec sa raison. Un réglage
 * ajouté au schéma sans champ correspondant fait échouer la suite.
 */

import type { FieldDescriptor } from './form-binding.js';
import type { FieldViewId } from './router.js';

export interface AdminField extends FieldDescriptor {
  /** Vue qui affiche ce champ. */
  readonly view: FieldViewId;
  /** Libellé, en français, affiché à côté du champ. */
  readonly label: string;
  /** Précision affichée sous le champ, quand la valeur n'est pas évidente. */
  readonly hint?: string;
}

/* -------------------------------------------------------------------------- */
/* Réglages délibérément absents du panneau                                    */
/* -------------------------------------------------------------------------- */

/**
 * Feuilles de la configuration qui n'ont pas de champ, et pourquoi.
 *
 * Chaque entrée est une décision, pas un oubli — c'est précisément ce que le
 * test vérifie. Une raison vague y serait aussi visible qu'un réglage manquant.
 */
export const UNBOUND_PATHS: Readonly<Record<string, string>> = {
  schemaVersion:
    'Métadonnée de migration et non un réglage : l’exposer inviterait à la modifier, ce qui ferait repartir de zéro une configuration parfaitement valide.',

  'setup.completed':
    'État de l’assistant de première configuration, écrit par lui seul. Le remettre à faux depuis le panneau n’aurait d’autre effet que de renvoyer la racine vers /setup.',

  'twitch.broadcasterUserId':
    'Résolu automatiquement à la validation du jeton OAuth, jamais saisi. Le modifier à la main pointerait le subathon vers une chaîne qui n’a pas autorisé l’application.',

  'twitch.broadcasterLogin':
    'Résolu en même temps que l’identifiant, et affiché en lecture seule dans la vue Twitch. Le saisir ne changerait pas la chaîne réellement écoutée.',

  'rewards.bits.tiers':
    'Tableau de paliers à cardinalité variable : ce n’est pas un champ mais un éditeur, tenu par la vue Barème avec son propre module.',
};

/* -------------------------------------------------------------------------- */
/* Barème                                                                      */
/* -------------------------------------------------------------------------- */

/** Une journée en secondes : plafond partagé par toutes les récompenses. */
const DAY = 86_400;

/** Récompense en secondes : jamais négative, jamais délirante. */
function reward(selector: string, path: string, label: string, view: FieldViewId = 'rewards'): AdminField {
  return { selector, path, label, view, kind: 'integer', min: 0, max: DAY };
}

const REWARD_FIELDS: readonly AdminField[] = [
  reward('#reward-sub-prime', 'rewards.sub.prime', 'Prime'),
  reward('#reward-sub-tier1', 'rewards.sub.tier1', 'Tier 1'),
  reward('#reward-sub-tier2', 'rewards.sub.tier2', 'Tier 2'),
  reward('#reward-sub-tier3', 'rewards.sub.tier3', 'Tier 3'),

  reward('#reward-resub-prime', 'rewards.resub.prime', 'Prime'),
  reward('#reward-resub-tier1', 'rewards.resub.tier1', 'Tier 1'),
  reward('#reward-resub-tier2', 'rewards.resub.tier2', 'Tier 2'),
  reward('#reward-resub-tier3', 'rewards.resub.tier3', 'Tier 3'),

  reward('#reward-gift-tier1', 'rewards.gift.tier1', 'Tier 1'),
  reward('#reward-gift-tier2', 'rewards.gift.tier2', 'Tier 2'),
  reward('#reward-gift-tier3', 'rewards.gift.tier3', 'Tier 3'),
  {
    selector: '#reward-gift-max',
    path: 'rewards.gift.maxPerEvent',
    label: 'Plafond par événement',
    hint: 'Un don de cent abonnements créditerait autrement cinq heures d’un coup.',
    view: 'rewards',
    kind: 'integer',
    min: 1,
    max: DAY,
  },

  {
    selector: '#reward-bits-mode',
    path: 'rewards.bits.mode',
    label: 'Mode de calcul',
    hint: 'Proportionnel au nombre de bits, ou par seuils.',
    view: 'rewards',
    kind: 'enum',
    options: ['linear', 'tiers'],
  },
  {
    selector: '#reward-bits-unit',
    path: 'rewards.bits.linear.unit',
    label: 'Bits par unité',
    view: 'rewards',
    kind: 'integer',
    min: 1,
  },
  reward('#reward-bits-seconds', 'rewards.bits.linear.secondsPerUnit', 'Secondes par unité'),
  {
    selector: '#reward-bits-min',
    path: 'rewards.bits.linear.minBits',
    label: 'Bits minimum',
    hint: 'En deçà de ce seuil, rien n’est crédité.',
    view: 'rewards',
    kind: 'integer',
    min: 1,
  },
  {
    selector: '#reward-bits-max',
    path: 'rewards.bits.maxPerEvent',
    label: 'Plafond par événement',
    view: 'rewards',
    kind: 'integer',
    min: 1,
    max: DAY,
  },

  {
    selector: '#reward-raid-enabled',
    path: 'rewards.raid.enabled',
    label: 'Créditer les raids',
    hint: 'Désactivé par défaut : un raid n’est pas un soutien financier.',
    view: 'rewards',
    kind: 'boolean',
  },
  reward('#reward-raid-per-viewer', 'rewards.raid.secondsPerViewer', 'Secondes par spectateur'),
  {
    selector: '#reward-raid-min',
    path: 'rewards.raid.minViewers',
    label: 'Spectateurs minimum',
    hint: 'Ignore les raids trop petits, souvent automatisés.',
    view: 'rewards',
    kind: 'integer',
    min: 1,
  },
  {
    selector: '#reward-raid-max',
    path: 'rewards.raid.maxSeconds',
    label: 'Plafond par raid',
    view: 'rewards',
    kind: 'integer',
    min: 1,
    max: DAY,
  },

  {
    selector: '#reward-follow-enabled',
    path: 'rewards.follow.enabled',
    label: 'Créditer les follows',
    hint: 'Désactivé par défaut : trop exposé aux robots de follow.',
    view: 'rewards',
    kind: 'boolean',
  },
  reward('#reward-follow-seconds', 'rewards.follow.seconds', 'Secondes par follow'),
  {
    selector: '#reward-follow-max-hour',
    path: 'rewards.follow.maxPerHour',
    label: 'Plafond par heure',
    hint: 'Garde-fou anti-robots, sur une heure glissante.',
    view: 'rewards',
    kind: 'integer',
    min: 1,
  },
];

/* -------------------------------------------------------------------------- */
/* Apparence                                                                   */
/* -------------------------------------------------------------------------- */

const APPEARANCE_FIELDS: readonly AdminField[] = [
  {
    selector: '#overlay-font-family',
    path: 'overlay.fontFamily',
    label: 'Police',
    hint: 'Polices installées sur la machine uniquement : l’application doit fonctionner hors ligne.',
    view: 'appearance',
    kind: 'text',
  },
  {
    selector: '#overlay-font-size',
    path: 'overlay.fontSize',
    label: 'Taille, en pixels',
    view: 'appearance',
    kind: 'integer',
    min: 1,
    max: 1_000,
  },
  {
    selector: '#overlay-font-weight',
    path: 'overlay.fontWeight',
    label: 'Graisse',
    view: 'appearance',
    kind: 'integer',
    min: 100,
    max: 900,
  },
  {
    selector: '#overlay-letter-spacing',
    path: 'overlay.letterSpacing',
    label: 'Interlettrage, en pixels',
    view: 'appearance',
    kind: 'number',
  },
  { selector: '#overlay-color', path: 'overlay.color', label: 'Couleur', view: 'appearance', kind: 'color' },
  {
    selector: '#overlay-text-align',
    path: 'overlay.textAlign',
    label: 'Alignement',
    view: 'appearance',
    kind: 'enum',
    options: ['left', 'center', 'right'],
  },
  {
    selector: '#overlay-show-days',
    path: 'overlay.showDays',
    label: 'Afficher les jours au-delà de 24 h',
    view: 'appearance',
    kind: 'boolean',
  },
  {
    selector: '#overlay-hide-empty-hours',
    path: 'overlay.hideEmptyHours',
    label: 'Masquer les heures sous une heure',
    view: 'appearance',
    kind: 'boolean',
  },

  { selector: '#overlay-shadow-enabled', path: 'overlay.shadow.enabled', label: 'Ombre portée', view: 'appearance', kind: 'boolean' },
  { selector: '#overlay-shadow-color', path: 'overlay.shadow.color', label: 'Couleur de l’ombre', view: 'appearance', kind: 'color' },
  { selector: '#overlay-shadow-blur', path: 'overlay.shadow.blur', label: 'Flou', view: 'appearance', kind: 'number', min: 0 },
  { selector: '#overlay-shadow-offset-x', path: 'overlay.shadow.offsetX', label: 'Décalage horizontal', view: 'appearance', kind: 'number' },
  { selector: '#overlay-shadow-offset-y', path: 'overlay.shadow.offsetY', label: 'Décalage vertical', view: 'appearance', kind: 'number' },

  { selector: '#overlay-outline-enabled', path: 'overlay.outline.enabled', label: 'Contour', view: 'appearance', kind: 'boolean' },
  { selector: '#overlay-outline-color', path: 'overlay.outline.color', label: 'Couleur du contour', view: 'appearance', kind: 'color' },
  { selector: '#overlay-outline-width', path: 'overlay.outline.width', label: 'Épaisseur', view: 'appearance', kind: 'number', min: 0 },

  { selector: '#overlay-glow-enabled', path: 'overlay.glow.enabled', label: 'Halo', view: 'appearance', kind: 'boolean' },
  { selector: '#overlay-glow-color', path: 'overlay.glow.color', label: 'Couleur du halo', view: 'appearance', kind: 'color' },
  { selector: '#overlay-glow-radius', path: 'overlay.glow.radius', label: 'Rayon', view: 'appearance', kind: 'number', min: 0 },

  {
    selector: '#overlay-animation-on-add',
    path: 'overlay.animation.onAdd',
    label: 'Effet à chaque ajout',
    view: 'appearance',
    kind: 'enum',
    options: ['none', 'flash', 'pulse', 'shake'],
  },
  {
    selector: '#overlay-animation-duration',
    path: 'overlay.animation.durationMs',
    label: 'Durée de l’effet, en ms',
    view: 'appearance',
    kind: 'integer',
    min: 1,
    max: 10_000,
  },

  { selector: '#overlay-toast-enabled', path: 'overlay.toast.enabled', label: 'Bulles d’annonce', view: 'appearance', kind: 'boolean' },
  {
    selector: '#overlay-toast-duration',
    path: 'overlay.toast.durationMs',
    label: 'Durée d’une bulle, en ms',
    view: 'appearance',
    kind: 'integer',
    min: 1,
    max: 60_000,
  },
  { selector: '#overlay-toast-color', path: 'overlay.toast.color', label: 'Couleur des bulles', view: 'appearance', kind: 'color' },
  {
    selector: '#overlay-toast-font-size',
    path: 'overlay.toast.fontSize',
    label: 'Taille des bulles, en pixels',
    view: 'appearance',
    kind: 'integer',
    min: 1,
    max: 500,
  },
  {
    selector: '#overlay-custom-css',
    path: 'overlay.enableCustomCss',
    label: 'Charger custom.css depuis le répertoire de données',
    hint: 'Appliquée en dernier, elle peut tout surcharger.',
    view: 'appearance',
    kind: 'boolean',
  },
];

/* -------------------------------------------------------------------------- */
/* Twitch                                                                      */
/* -------------------------------------------------------------------------- */

const TWITCH_FIELDS: readonly AdminField[] = [
  {
    selector: '#twitch-client-id',
    path: 'twitch.clientId',
    label: 'Client ID',
    hint: 'Le secret associé ne se lit jamais : pour le changer, saisissez-en un nouveau.',
    view: 'twitch',
    kind: 'text',
  },
  {
    selector: '#twitch-chat-notifications',
    path: 'twitch.enableChatNotifications',
    label: 'Distinguer les abonnements Prime',
    hint: 'Seul channel.chat.notification expose is_prime. Sans lui, Prime est traité comme un Tier 1.',
    view: 'twitch',
    kind: 'boolean',
  },
  { selector: '#twitch-enable-raid', path: 'twitch.enableRaid', label: 'S’abonner aux raids', view: 'twitch', kind: 'boolean' },
  { selector: '#twitch-enable-follow', path: 'twitch.enableFollow', label: 'S’abonner aux follows', view: 'twitch', kind: 'boolean' },
  {
    selector: '#twitch-keepalive',
    path: 'twitch.keepaliveTimeoutSeconds',
    label: 'Délai de keepalive, en secondes',
    hint: 'Plage imposée par Twitch : 10 à 600.',
    view: 'twitch',
    kind: 'integer',
    min: 10,
    max: 600,
  },
  {
    selector: '#twitch-eventsub-url',
    path: 'twitch.eventsubUrl',
    label: 'Point d’entrée EventSub',
    hint: 'À surcharger pour viser le serveur factice de la Twitch CLI.',
    view: 'twitch',
    kind: 'text',
  },
  { selector: '#twitch-helix-url', path: 'twitch.helixBaseUrl', label: 'API Helix', view: 'twitch', kind: 'text' },
  { selector: '#twitch-id-url', path: 'twitch.idBaseUrl', label: 'Service d’identité', view: 'twitch', kind: 'text' },
];

/* -------------------------------------------------------------------------- */
/* Paramètres                                                                  */
/* -------------------------------------------------------------------------- */

/** Trente jours : au-delà, ce n'est plus un subathon. */
const MAX_INITIAL_SECONDS = 2_592_000;

const SETTINGS_FIELDS: readonly AdminField[] = [
  {
    selector: '#counter-initial',
    path: 'counter.initialSeconds',
    label: 'Valeur de départ, en secondes',
    hint: 'La changer en plein subathon ne touche pas au temps restant.',
    view: 'settings',
    kind: 'integer',
    min: 1,
    max: MAX_INITIAL_SECONDS,
  },
  {
    selector: '#counter-min',
    path: 'counter.minRemainingSeconds',
    label: 'Plancher, en secondes',
    view: 'settings',
    kind: 'integer',
    min: 0,
  },
  {
    selector: '#counter-max',
    path: 'counter.maxRemainingSeconds',
    label: 'Plafond, en secondes',
    hint: 'Doit rester strictement supérieur au plancher.',
    view: 'settings',
    kind: 'integer',
    min: 1,
  },
  {
    selector: '#counter-tick',
    path: 'counter.tickIntervalMs',
    label: 'Période du décompte interne, en ms',
    hint: 'L’overlay interpole de son côté : cette valeur ne change pas la fluidité.',
    view: 'settings',
    kind: 'integer',
    min: 1,
  },
  {
    selector: '#counter-persist',
    path: 'counter.persistIntervalMs',
    label: 'Période de sauvegarde, en ms',
    hint: 'En cas de crash, on perd au pire cet intervalle — toujours en faveur du streamer.',
    view: 'settings',
    kind: 'integer',
    min: 1,
  },
  {
    selector: '#counter-resume',
    path: 'counter.resumeOnStartup',
    label: 'Reprendre le décompte au démarrage',
    view: 'settings',
    kind: 'boolean',
  },

  {
    selector: '#server-port',
    path: 'server.httpPort',
    label: 'Port HTTP',
    hint: 'Prend effet au prochain démarrage.',
    view: 'settings',
    kind: 'integer',
    min: 1,
    max: 65_535,
  },
  {
    selector: '#server-host',
    path: 'server.host',
    label: 'Adresse d’écoute',
    hint: 'Restreinte à la boucle locale : le panneau peut modifier le compteur.',
    view: 'settings',
    kind: 'enum',
    options: ['127.0.0.1', 'localhost'],
  },
  {
    selector: '#server-fallback',
    path: 'server.portFallbackAttempts',
    label: 'Ports essayés si le port choisi est pris',
    view: 'settings',
    kind: 'integer',
    min: 0,
    max: 50,
  },
  {
    selector: '#server-max-body',
    path: 'server.maxBodyBytes',
    label: 'Plafond du corps d’une requête, en octets',
    view: 'settings',
    kind: 'integer',
    min: 1,
    max: 10_485_760,
  },
  {
    selector: '#ws-heartbeat',
    path: 'server.websocket.heartbeatIntervalMs',
    label: 'Période des pings, en ms',
    view: 'settings',
    kind: 'integer',
    min: 1,
  },
  {
    selector: '#ws-broadcast',
    path: 'server.websocket.stateBroadcastIntervalMs',
    label: 'Période de diffusion de l’état, en ms',
    hint: 'Diffuser plus souvent réveillerait la Browser Source d’OBS sans rien améliorer.',
    view: 'settings',
    kind: 'integer',
    min: 1,
  },
  {
    selector: '#ws-max-message',
    path: 'server.websocket.maxMessageBytes',
    label: 'Plafond d’un message entrant, en octets',
    view: 'settings',
    kind: 'integer',
    min: 1,
    max: 65_536,
  },

  {
    selector: '#logging-level',
    path: 'logging.level',
    label: 'Niveau de journalisation',
    view: 'settings',
    kind: 'enum',
    options: ['debug', 'info', 'warning', 'error'],
  },
  {
    selector: '#logging-retention',
    path: 'logging.retentionDays',
    label: 'Rétention des journaux, en jours',
    view: 'settings',
    kind: 'integer',
    min: 1,
    max: 365,
  },
  {
    selector: '#logging-ring',
    path: 'logging.ringBufferSize',
    label: 'Enregistrements gardés en mémoire',
    view: 'settings',
    kind: 'integer',
    min: 50,
    max: 10_000,
  },
  {
    selector: '#logging-console',
    path: 'logging.console',
    label: 'Écrire aussi sur la console',
    view: 'settings',
    kind: 'boolean',
  },

  {
    selector: '#history-retention',
    path: 'history.retentionDays',
    label: 'Rétention de l’historique, en jours',
    view: 'settings',
    kind: 'integer',
    min: 1,
    max: 365,
  },
  {
    selector: '#history-dedup-size',
    path: 'history.dedupCacheSize',
    label: 'Taille du cache de déduplication',
    view: 'settings',
    kind: 'integer',
    min: 100,
    max: 100_000,
  },
  {
    selector: '#history-dedup-ttl',
    path: 'history.dedupTtlMs',
    label: 'Durée de vie d’un identifiant, en ms',
    view: 'settings',
    kind: 'integer',
    min: 1,
  },
  {
    selector: '#history-cross-source',
    path: 'history.crossSourceWindowMs',
    label: 'Fenêtre de corrélation entre sources, en ms',
    hint: 'Corrèle channel.subscribe et channel.chat.notification décrivant le même abonnement.',
    view: 'settings',
    kind: 'integer',
    min: 1,
  },
];

/* -------------------------------------------------------------------------- */
/* Table complète                                                              */
/* -------------------------------------------------------------------------- */

export const ADMIN_FIELDS: readonly AdminField[] = [
  ...REWARD_FIELDS,
  ...APPEARANCE_FIELDS,
  ...TWITCH_FIELDS,
  ...SETTINGS_FIELDS,
];

/** Champs d'une vue, dans l'ordre de déclaration. */
export function fieldsOf(view: FieldViewId): readonly AdminField[] {
  return ADMIN_FIELDS.filter((field) => field.view === view);
}

/* -------------------------------------------------------------------------- */
/* Regroupement                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Titres des groupes, par préfixe de chemin.
 *
 * Le regroupement est déduit du chemin plutôt que déclaré ligne à ligne : la
 * hiérarchie du schéma **est** la structure naturelle de l'interface, et la
 * recopier soixante fois créerait une seconde source de vérité à maintenir
 * d'accord avec la première.
 *
 * L'ordre compte doublement : c'est celui des sections à l'écran, et la
 * recherche retient le **premier** préfixe qui correspond, si bien qu'un
 * préfixe long doit précéder le plus court qui le contient.
 */
const GROUPS: readonly (readonly [string, string])[] = [
  ['rewards.sub.', 'Abonnements'],
  ['rewards.resub.', 'Réabonnements'],
  ['rewards.gift.', 'Dons d’abonnement'],
  ['rewards.bits.', 'Bits'],
  ['rewards.raid.', 'Raids'],
  ['rewards.follow.', 'Follows'],

  ['overlay.shadow.', 'Ombre portée'],
  ['overlay.outline.', 'Contour'],
  ['overlay.glow.', 'Halo'],
  ['overlay.animation.', 'Animation'],
  ['overlay.toast.', 'Bulles d’annonce'],
  ['overlay.', 'Texte du compteur'],

  ['twitch.', 'Connexion et souscriptions'],

  ['counter.', 'Compteur'],
  ['server.websocket.', 'WebSocket'],
  ['server.', 'Serveur local'],
  ['logging.', 'Journalisation'],
  ['history.', 'Historique'],
];

/** Titres des groupes d'une vue, dans l'ordre d'affichage, sans doublon. */
export function groupsOf(view: FieldViewId): readonly string[] {
  const seen: string[] = [];

  for (const [prefix, label] of GROUPS) {
    const matches = ADMIN_FIELDS.some(
      (field) => field.view === view && groupOf(field.path) === label && field.path.startsWith(prefix),
    );
    if (matches && !seen.includes(label)) {
      seen.push(label);
    }
  }

  return seen;
}

/** Groupe d'un champ, déduit de son chemin. */
export function groupOf(path: string): string {
  for (const [prefix, label] of GROUPS) {
    if (path.startsWith(prefix)) {
      return label;
    }
  }

  // Inatteignable tant que le test de couverture passe : il exige que chaque
  // champ tombe dans un groupe connu.
  return 'Divers';
}
