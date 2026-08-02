/**
 * Progression de l'assistant de première configuration.
 *
 * L'exigence est « reprise possible à l'étape interrompue ». La façon évidente
 * de la satisfaire — enregistrer un numéro d'étape — est aussi la mauvaise :
 * ce numéro se désynchronise du réel à la première anomalie. Un streamer qui
 * révoque son jeton depuis Twitch, qui restaure une ancienne configuration, ou
 * qui ferme l'assistant en plein flux OAuth se retrouverait renvoyé à une étape
 * qui ne décrit plus rien.
 *
 * L'étape est donc **dérivée de l'état réel**, lu à chaque ouverture depuis
 * `GET /api/twitch/status` et `GET /api/config`. Une seule chose est persistée,
 * `setup.completed`, parce qu'elle ne se déduit de rien : la valeur de départ du
 * compteur a toujours une valeur par défaut, on ne peut pas distinguer
 * « laissée telle quelle » de « jamais vue ».
 *
 * Module pur, sans DOM et sans requête : tout l'enchaînement de l'assistant se
 * vérifie sans navigateur ni serveur.
 */

/**
 * Les six étapes, dans l'ordre.
 *
 * - `intro` : où créer une application Twitch, et quelle redirect URI y coller ;
 * - `credentials` : saisie du client ID et du secret ;
 * - `connect` : lancement du flux d'autorisation ;
 * - `channel` : chaîne détectée et portées réellement accordées ;
 * - `counter` : valeur de départ et barème ;
 * - `overlay` : adresse à coller dans une Browser Source OBS.
 */
export const SETUP_STEPS = [
  'intro',
  'credentials',
  'connect',
  'channel',
  'counter',
  'overlay',
] as const;

export type SetupStepId = (typeof SETUP_STEPS)[number];

/** Ce que l'assistant sait de la configuration, à l'instant où il s'ouvre. */
export interface SetupState {
  readonly clientId: string;
  /** Booléen et jamais la valeur : le secret s'écrit et ne se relit pas. */
  readonly hasClientSecret: boolean;
  readonly connected: boolean;
  readonly broadcasterLogin: string;
  /** Portées requises que Twitch n'a pas accordées. */
  readonly missingScopes: readonly string[];
  /** `setup.completed` de la configuration. */
  readonly completed: boolean;
}

/** Les deux identifiants d'application sont-ils en place ? */
function hasCredentials(state: SetupState): boolean {
  return state.clientId !== '' && state.hasClientSecret;
}

/**
 * Étape à laquelle reprendre.
 *
 * L'ordre des conditions suit la dépendance réelle et non la numérotation :
 * c'est ce qui permet de retomber à `connect` alors même que l'assistant est
 * marqué terminé, lorsque le jeton a été révoqué depuis Twitch.
 */
export function resumeStep(state: SetupState): SetupStepId {
  if (!hasCredentials(state)) {
    // Rien de saisi du tout : l'explication est le seul écran qui ait du sens.
    // Dès qu'une valeur existe, y renvoyer ferait relire ce qu'on vient de faire.
    return state.clientId === '' && !state.hasClientSecret ? 'intro' : 'credentials';
  }

  if (!state.connected) {
    return 'connect';
  }

  // L'écran utile à quiconque revient une fois tout réglé : l'adresse à coller
  // dans OBS.
  if (state.completed) {
    return 'overlay';
  }

  // La reprise s'arrête ici. `channel` confirme que la connexion a abouti et sur
  // quelle chaîne, et signale une portée manquante — qui se corrige en refaisant
  // le flux d'autorisation, faute de quoi le streamer découvrirait en direct que
  // ses abonnements ne créditent rien. Le barème se rejoint en avançant : y
  // déposer quelqu'un sans lui montrer d'abord que Twitch est branché laisserait
  // le doute sur l'étape précédente.
  return 'channel';
}

/**
 * Cette étape a-t-elle quelque chose à montrer maintenant ?
 *
 * Distinct de `resumeStep` : celui-ci dit où reprendre, celui-là dit ce que la
 * navigation peut ouvrir. Les confondre laisserait afficher « chaîne détectée »
 * alors qu'aucun jeton n'a été obtenu.
 */
export function isStepReachable(step: SetupStepId, state: SetupState): boolean {
  switch (step) {
    case 'intro':
    case 'credentials':
      return true;
    case 'connect':
      return hasCredentials(state);
    case 'channel':
    case 'counter':
    case 'overlay':
      return state.connected;
  }
}

/**
 * Phrase affichée sous le titre de l'assistant.
 *
 * Elle est ici et non dans le gabarit parce qu'elle **dépend de l'état**, et
 * qu'un texte conditionnel laissé dans la page finit par mentir : « Reprise là
 * où vous vous étiez arrêté » s'affichait à la première étape d'une
 * installation neuve, où rien n'avait jamais été commencé. C'est la première
 * phrase que lit un nouvel utilisateur.
 *
 * L'achèvement l'emporte sur la reprise : une configuration terminée dont le
 * jeton a été révoqué depuis Twitch reprend à `connect`, et annoncer alors
 * qu'elle n'a jamais été menée à son terme serait faux une seconde fois.
 */
export function resumeHint(state: SetupState): string {
  if (state.completed) {
    return 'Configuration terminée. Vous pouvez la reprendre à tout moment.';
  }

  if (state.clientId === '' && !state.hasClientSecret) {
    return 'Six étapes, et quelques minutes.';
  }

  return 'Reprise là où vous vous étiez arrêté.';
}
