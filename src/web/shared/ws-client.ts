/**
 * Client du WebSocket local, partagé par l'overlay et le panneau
 * d'administration.
 *
 * Toute la mécanique de reconnexion vit ici, et nulle part ailleurs. La raison
 * est une contrainte d'OBS : une Browser Source est chargée une fois, au
 * démarrage de la scène, et n'est **jamais** rechargée automatiquement. Une
 * page qui abandonne après un échec reste morte jusqu'à ce que le streamer s'en
 * aperçoive, c'est-à-dire en direct. Le client réessaie donc indéfiniment.
 *
 * Le socket, les minuteurs et la source d'aléa sont injectés. Ce n'est pas de
 * la cérémonie : c'est ce qui rend vérifiable en quelques millisecondes un
 * plafond de retrait de trente secondes, et ce qui permet de tester ce module
 * dans un conteneur qui n'a pas de navigateur.
 */

import { parseServerMessage, type Channel, type ServerMessage } from './protocol.js';

/* -------------------------------------------------------------------------- */
/* Ports                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Surface minimale d'un socket.
 *
 * Volontairement plus étroite que `WebSocket` du navigateur : le seul
 * adaptateur concret y ramène l'objet natif, en particulier en dépliant
 * `MessageEvent.data` pour que ce module n'ait pas à connaître le DOM.
 */
export interface WsSocket {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((data: unknown) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

export type WsSocketFactory = (url: string) => WsSocket;

/** Minuteurs injectés, pour que les tests n'attendent jamais réellement. */
export interface TimerPort {
  setTimeout(run: () => void, delayMs: number): number;
  clearTimeout(id: number): void;
}

export type WsClientStatus = 'connecting' | 'open' | 'reconnecting' | 'stopped';

export interface BackoffOptions {
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly factor: number;
  /** Amplitude relative du bruit ajouté au délai, de part et d'autre. */
  readonly jitterRatio: number;
}

/**
 * Réglages par défaut du retrait.
 *
 * Un demi-seconde pour ne rien perdre d'un simple redémarrage de ChronoCast,
 * trente secondes de plafond pour ne pas marteler une machine éteinte.
 */
export const DEFAULT_BACKOFF: BackoffOptions = {
  initialDelayMs: 500,
  maxDelayMs: 30_000,
  factor: 2,
  jitterRatio: 0.2,
};

/* -------------------------------------------------------------------------- */
/* Retrait exponentiel                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Délai avant la n-ième tentative, en millisecondes.
 *
 * Fonction pure et exportée : c'est la seule partie de la politique de
 * reconnexion qui mérite d'être vérifiée sur toute sa plage, et l'isoler évite
 * d'avoir à piloter une machine à états pour observer un plafond.
 */
export function backoffDelay(
  attempt: number,
  options: BackoffOptions,
  random: () => number,
): number {
  const base = Math.min(options.initialDelayMs * options.factor ** (attempt - 1), options.maxDelayMs);

  // Le bruit est symétrique : il ne rallonge pas systématiquement l'attente.
  const jitter = base * options.jitterRatio * (random() * 2 - 1);

  // Un jitter mal réglé ne doit pas pouvoir produire un délai négatif, que le
  // minuteur interpréterait comme « immédiatement », en boucle.
  return Math.max(0, Math.round(base + jitter));
}

/* -------------------------------------------------------------------------- */
/* Client                                                                      */
/* -------------------------------------------------------------------------- */

export interface WsClientOptions {
  readonly url: string;
  /** Canaux demandés à l'ouverture. Le hub remplace l'abonnement, il ne l'ajoute pas. */
  readonly channels: readonly Channel[];
  readonly createSocket: WsSocketFactory;
  readonly onMessage: (message: ServerMessage) => void;
  readonly onStatusChange?: (status: WsClientStatus) => void;
  readonly timers: TimerPort;
  readonly random?: () => number;
  readonly backoff?: BackoffOptions;
}

export interface WsClient {
  start(): void;
  stop(): void;
  getStatus(): WsClientStatus;
}

export function createWsClient(options: WsClientOptions): WsClient {
  const backoff = options.backoff ?? DEFAULT_BACKOFF;
  const random = options.random ?? Math.random;

  let socket: WsSocket | null = null;
  let retryTimer: number | null = null;
  let attempt = 0;
  let stopped = false;
  let status: WsClientStatus = 'connecting';
  let announced = false;

  function setStatus(next: WsClientStatus): void {
    if (announced && next === status) {
      return;
    }
    status = next;
    announced = true;
    options.onStatusChange?.(next);
  }

  function connect(): void {
    setStatus('connecting');

    const opened = options.createSocket(options.url);
    socket = opened;

    opened.onopen = (): void => {
      // La connexion a abouti : la suite des délais repart de zéro, sans quoi
      // une coupure brève survenue tard coûterait une attente maximale.
      attempt = 0;
      setStatus('open');
      opened.send(JSON.stringify({ type: 'subscribe', channels: [...options.channels] }));
    };

    opened.onmessage = (data: unknown): void => {
      const message = parseServerMessage(data);
      if (message !== null) {
        options.onMessage(message);
      }
    };

    opened.onclose = handleDisconnect;
    opened.onerror = handleDisconnect;
  }

  function handleDisconnect(): void {
    if (stopped) {
      return;
    }

    // Un navigateur émet `error` **puis** `close` sur un échec de connexion.
    // Sans cette garde, chaque échec programmerait deux tentatives et la
    // cadence doublerait à chaque tour.
    if (retryTimer !== null) {
      return;
    }

    socket = null;
    attempt += 1;
    setStatus('reconnecting');

    retryTimer = options.timers.setTimeout(() => {
      retryTimer = null;
      connect();
    }, backoffDelay(attempt, backoff, random));
  }

  return {
    start(): void {
      stopped = false;
      connect();
    },

    stop(): void {
      stopped = true;

      if (retryTimer !== null) {
        options.timers.clearTimeout(retryTimer);
        retryTimer = null;
      }

      socket?.close();
      socket = null;
      setStatus('stopped');
    },

    getStatus(): WsClientStatus {
      return status;
    },
  };
}
