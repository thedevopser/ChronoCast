/**
 * État du compteur et transitions pures.
 *
 * Tout ce qui suit est sans effet de bord : pas d'horloge interne, pas
 * d'entrées-sorties, pas de minuteur. Chaque fonction se ramène à
 * « état + action donne nouvel état », l'instant courant étant fourni par
 * l'appelant.
 *
 * Cette séparation rend vérifiables sans attendre une seule seconde réelle des
 * situations qui prendraient des heures à reproduire : atteinte du plancher,
 * plafond dépassé par une salve de gift subs, reprise après pause. Elle isole
 * aussi les règles métier de la mécanique d'ordonnancement, qui vit dans
 * `counter-service.ts`.
 *
 * Convention : lorsqu'une action n'a aucun effet — décompte à l'arrêt, valeur
 * nulle, compteur déjà achevé — l'état **exactement identique** est renvoyé, et
 * non une copie. Le service peut ainsi éviter une écriture disque et une
 * diffusion WebSocket inutiles par simple comparaison de référence.
 */

/**
 * Cycle de vie du compteur.
 *
 * - `idle` : jamais démarré, ou réinitialisé.
 * - `running` : le décompte progresse.
 * - `paused` : figé volontairement, le temps ne s'écoule pas.
 * - `finished` : le plancher est atteint ; seul un ajout de temps ou une
 *   réinitialisation en fait sortir.
 */
export type CounterStatus = 'idle' | 'running' | 'paused' | 'finished';

/** Version de la structure persistée, pour les migrations futures. */
export const COUNTER_STATE_VERSION = 1;

export interface CounterState {
  /** Temps restant en millisecondes. Toujours compris entre les bornes. */
  readonly remainingMs: number;

  readonly status: CounterStatus;

  /** Valeur de départ, utilisée par la réinitialisation. */
  readonly initialMs: number;

  /** Cumul du temps réellement crédité, plafonnement déduit. */
  readonly totalAddedMs: number;

  /** Cumul du temps réellement retiré, plancher déduit. */
  readonly totalRemovedMs: number;

  /** Premier démarrage, en millisecondes depuis l'époque. `null` si jamais démarré. */
  readonly startedAt: number | null;

  /** Instant d'atteinte du plancher. `null` tant que le compteur n'est pas achevé. */
  readonly finishedAt: number | null;

  /** Dernière transition effective. */
  readonly updatedAt: number;

  readonly schemaVersion: number;
}

/** Bornes appliquées au temps restant. */
export interface CounterBounds {
  /**
   * Plancher.
   *
   * Le compteur ne descend jamais en dessous, et l'atteindre marque la fin du
   * subathon. À zéro — le cas courant — le décompte s'achève à zéro.
   */
  readonly minRemainingMs: number;

  /**
   * Plafond.
   *
   * Sans lui, une salve de gift subs pourrait porter le compteur à plusieurs
   * jours et enfermer le streamer dans un engagement intenable.
   */
  readonly maxRemainingMs: number;
}

export interface CreateInitialStateParams {
  readonly initialMs: number;
  readonly now: number;
}

export interface TickParams {
  /** Temps écoulé depuis le tick précédent, mesuré sur l'horloge monotone. */
  readonly elapsedMs: number;
  readonly bounds: CounterBounds;
  readonly now: number;
}

export interface DeltaParams {
  readonly deltaMs: number;
  readonly bounds: CounterBounds;
  readonly now: number;
}

export interface InstantParams {
  readonly now: number;
}

export interface SetInitialParams {
  readonly initialMs: number;
  readonly bounds: CounterBounds;
  readonly now: number;
}

/** Restreint une valeur à l'intervalle des bornes. */
function clamp(value: number, bounds: CounterBounds): number {
  if (value < bounds.minRemainingMs) {
    return bounds.minRemainingMs;
  }
  if (value > bounds.maxRemainingMs) {
    return bounds.maxRemainingMs;
  }
  return value;
}

export function createInitialState(params: CreateInitialStateParams): CounterState {
  return {
    remainingMs: params.initialMs,
    status: 'idle',
    initialMs: params.initialMs,
    totalAddedMs: 0,
    totalRemovedMs: 0,
    startedAt: null,
    finishedAt: null,
    updatedAt: params.now,
    schemaVersion: COUNTER_STATE_VERSION,
  };
}

/**
 * Fait progresser le décompte.
 *
 * Sans effet si le compteur n'est pas en cours : c'est ce qui implémente le mode
 * « gel », où le temps passé application fermée n'est jamais décompté.
 */
export function applyTick(state: CounterState, params: TickParams): CounterState {
  if (state.status !== 'running' || params.elapsedMs <= 0) {
    return state;
  }

  const remainingMs = clamp(state.remainingMs - params.elapsedMs, params.bounds);
  const reachedFloor = remainingMs <= params.bounds.minRemainingMs;

  return {
    ...state,
    remainingMs,
    status: reachedFloor ? 'finished' : state.status,
    finishedAt: reachedFloor ? params.now : state.finishedAt,
    updatedAt: params.now,
  };
}

/**
 * Crédite du temps.
 *
 * Relance un compteur achevé : un gift sub arrivant juste après la fin doit
 * rouvrir le subathon, c'est exactement ce que le spectateur croit acheter.
 * En revanche, un compteur jamais démarré n'est pas mis en route pour autant —
 * le streamer reste maître du moment où le décompte commence.
 */
export function applyAdd(state: CounterState, params: DeltaParams): CounterState {
  if (params.deltaMs <= 0) {
    return state;
  }

  const remainingMs = clamp(state.remainingMs + params.deltaMs, params.bounds);
  const actuallyAdded = remainingMs - state.remainingMs;

  if (actuallyAdded === 0) {
    return state;
  }

  const revives = state.status === 'finished' && remainingMs > params.bounds.minRemainingMs;

  return {
    ...state,
    remainingMs,
    // Seul le temps réellement crédité est comptabilisé : afficher un cumul
    // supérieur à ce que le compteur a reçu serait mensonger.
    totalAddedMs: state.totalAddedMs + actuallyAdded,
    status: revives ? 'running' : state.status,
    finishedAt: revives ? null : state.finishedAt,
    updatedAt: params.now,
  };
}

/** Retire du temps, sans jamais franchir le plancher. */
export function applyRemove(state: CounterState, params: DeltaParams): CounterState {
  if (params.deltaMs <= 0) {
    return state;
  }

  const remainingMs = clamp(state.remainingMs - params.deltaMs, params.bounds);
  const actuallyRemoved = state.remainingMs - remainingMs;

  if (actuallyRemoved === 0) {
    return state;
  }

  const reachedFloor = remainingMs <= params.bounds.minRemainingMs;

  return {
    ...state,
    remainingMs,
    totalRemovedMs: state.totalRemovedMs + actuallyRemoved,
    status: reachedFloor ? 'finished' : state.status,
    finishedAt: reachedFloor ? params.now : state.finishedAt,
    updatedAt: params.now,
  };
}

/** Fige le décompte. Sans effet si le compteur n'est pas en cours. */
export function applyPause(state: CounterState, params: InstantParams): CounterState {
  if (state.status !== 'running') {
    return state;
  }

  return { ...state, status: 'paused', updatedAt: params.now };
}

/**
 * Démarre ou reprend le décompte.
 *
 * Un compteur achevé n'est pas repris : il repartirait aussitôt en « achevé »
 * puisqu'il est au plancher. Il faut d'abord créditer du temps ou réinitialiser.
 */
export function applyResume(state: CounterState, params: InstantParams): CounterState {
  if (state.status !== 'idle' && state.status !== 'paused') {
    return state;
  }

  return {
    ...state,
    status: 'running',
    // Conservée à travers les pauses successives : c'est la date de début du
    // subathon, pas celle de la dernière reprise.
    startedAt: state.startedAt ?? params.now,
    updatedAt: params.now,
  };
}

/** Repart de la valeur initiale, compteurs cumulés remis à zéro. */
export function applyReset(state: CounterState, params: InstantParams): CounterState {
  return {
    ...createInitialState({ initialMs: state.initialMs, now: params.now }),
    schemaVersion: state.schemaVersion,
  };
}

/**
 * Change la valeur de départ.
 *
 * Le temps restant n'est répercuté que si le compteur est à l'arrêt : modifier
 * la valeur initiale en plein subathon ne doit pas effacer le temps déjà gagné
 * par les spectateurs.
 */
export function applySetInitial(state: CounterState, params: SetInitialParams): CounterState {
  if (params.initialMs <= 0) {
    return state;
  }

  if (state.status !== 'idle') {
    return { ...state, initialMs: params.initialMs, updatedAt: params.now };
  }

  return {
    ...state,
    initialMs: params.initialMs,
    remainingMs: clamp(params.initialMs, params.bounds),
    updatedAt: params.now,
  };
}
