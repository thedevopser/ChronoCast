/**
 * Service de mise à jour : interroger, télécharger, vérifier, proposer.
 *
 * Il orchestre les trois modules purs du dossier — `semver`, `release-feed`,
 * `digest` — et n'ajoute qu'une machine à états et une cadence. Tout ce qu'il
 * touche du monde extérieur lui est injecté : `fetch`, minuteurs, horloge,
 * disque, et le port qui lance l'installeur. Aucun test n'ouvre donc de socket,
 * n'attend une durée réelle ni n'écrit un octet.
 *
 * **Deux invariants gouvernent tout le fichier, et rien ne doit les affaiblir.**
 *
 * 1. **Rien n'est écrit sur le disque qui n'ait été vérifié.** Les octets sont
 *    tenus en mémoire, confrontés au condensat publié, et n'atteignent le
 *    disque qu'ensuite. Un installeur non vérifié posé dans `%APPDATA%` serait
 *    un exécutable que plus rien n'empêcherait de lancer à la main — et qui se
 *    lancerait sans invite, puisque le `fetch` de Node n'écrit aucune *Mark of
 *    the Web*.
 * 2. **Rien ne s'installe sans un clic.** Le téléchargement est automatique,
 *    l'installation ne l'est jamais. Un compteur de subathon tourne pendant des
 *    jours : redémarrer l'application sans le demander coûterait le direct.
 *
 * Un échec — réseau coupé, quota GitHub dépassé, condensat discordant — n'est
 * jamais bloquant. Il est journalisé, publié, et la tentative suivante aura
 * lieu au prochain rendez-vous.
 */

import type { Clock, UpdateInstaller } from '../app/ports.js';
import type { Logger } from '../logging/logger.js';
import type { Timers } from '../twitch/eventsub-client.js';
import { parseSha256File, sha256Hex } from './digest.js';
import { selectUpdate, type UpdateCandidate } from './release-feed.js';

/** Délai avant la toute première vérification, en millisecondes. */
const FIRST_CHECK_DELAY_MS = 30_000;

/** Période entre deux vérifications, en millisecondes. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;

/**
 * Plafond absolu du téléchargement, en octets.
 *
 * La release annonce une taille, et l'on s'y tient à une marge près ; ce
 * plafond-ci est le garde-fou de dernier recours, pour le cas où la taille
 * annoncée serait elle-même absurde. Une réponse sans fin remplirait le disque
 * de l'utilisateur, et le ferait pendant un direct.
 */
const MAX_DOWNLOAD_BYTES = 300 * 1024 * 1024;

/** Marge tolérée entre la taille annoncée par la release et celle reçue. */
const SIZE_TOLERANCE = 1.05;

/**
 * Phases du service.
 *
 * `disabled` et `unsupported` sont distinctes à dessein : la première est un
 * choix de l'utilisateur, la seconde une propriété du point d'entrée. Les
 * confondre ferait afficher « désactivé » à quelqu'un qui n'a rien désactivé.
 */
export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'ready'
  | 'error'
  | 'disabled'
  | 'unsupported';

export interface UpdateStatus {
  readonly phase: UpdatePhase;
  readonly currentVersion: string;
  /** Version prête ou en cours de téléchargement. `null` en dehors. */
  readonly availableVersion: string | null;
  /** Page de la release, pour lire les notes de version. */
  readonly notesUrl: string | null;
  /** Message destiné à l'utilisateur. `null` quand il n'y a rien à dire. */
  readonly message: string | null;
  /** Horodatage de la dernière vérification aboutie ou échouée. */
  readonly checkedAt: number | null;
}

/**
 * Accès disque du service, réduit à ce dont il a besoin.
 *
 * Une façade plutôt que `node:fs` directement : c'est ce qui permet aux tests
 * d'observer *ce qui est écrit et quand*, qui est précisément l'invariant à
 * défendre.
 */
export interface UpdateFileStore {
  /** Vide le répertoire des mises à jour. */
  clear(): Promise<void>;
  /** Écrit l'installeur vérifié et renvoie son chemin absolu. */
  save(name: string, bytes: Uint8Array): Promise<string>;
}

export interface UpdateService {
  /** Vide le répertoire et arme le premier rendez-vous. Ne vérifie rien tout de suite. */
  start(): void;
  /** Désarme tout. */
  stop(): void;
  /** Vérifie maintenant. Ne lève jamais : l'échec est dans le statut rendu. */
  check(): Promise<UpdateStatus>;
  /** Lance l'installeur prêt. Lève si rien ne l'est. */
  install(): Promise<void>;
  /** Relit le réglage et se réarme ou se désarme en conséquence. */
  refresh(): void;
  getStatus(): UpdateStatus;
}

export interface UpdateServiceOptions {
  readonly currentVersion: string;
  readonly owner: string;
  readonly repo: string;
  readonly fetch: typeof fetch;
  readonly timers: Timers;
  readonly clock: Clock;
  readonly files: UpdateFileStore;
  /** `null` sur un point d'entrée qui ne sait pas installer — le headless. */
  readonly installer: UpdateInstaller | null;
  readonly logger: Logger;
  /** Relu à chaque décision, jamais capturé : le réglage change à chaud. */
  readonly isEnabled: () => boolean;
  readonly onStatus: (status: UpdateStatus) => void;
  readonly firstCheckDelayMs?: number;
  readonly checkIntervalMs?: number;
}

export function createUpdateService(options: UpdateServiceOptions): UpdateService {
  const {
    currentVersion,
    owner,
    repo,
    fetch: doFetch,
    timers,
    clock,
    files,
    installer,
    isEnabled,
    onStatus,
    firstCheckDelayMs = FIRST_CHECK_DELAY_MS,
    checkIntervalMs = CHECK_INTERVAL_MS,
  } = options;

  const logger = options.logger.child('update');
  const supported = installer !== null;

  let status: UpdateStatus = {
    phase: supported ? 'idle' : 'unsupported',
    currentVersion,
    availableVersion: null,
    notesUrl: null,
    message: null,
    checkedAt: null,
  };

  /** Chemin de l'installeur vérifié, seule porte vers `install()`. */
  let readyPath: string | null = null;
  let timer: number | null = null;
  /** Empêche deux vérifications simultanées de se marcher dessus. */
  let running = false;

  function publish(next: Partial<UpdateStatus>): void {
    status = { ...status, ...next };
    onStatus(status);
  }

  function disarm(): void {
    if (timer !== null) {
      timers.clearTimeout(timer);
      timer = null;
    }
  }

  function arm(delayMs: number): void {
    disarm();
    timer = timers.setTimeout(() => {
      timer = null;
      void check().finally(() => {
        // Réarmé quoi qu'il arrive : un échec ne doit pas éteindre la cadence,
        // sans quoi une coupure réseau passagère priverait le poste de toutes
        // les mises à jour suivantes.
        if (isEnabled() && supported) {
          arm(checkIntervalMs);
        }
      });
    }, delayMs);
  }

  /** Écarte ce qui a été téléchargé et redescend à l'état neutre. */
  function forget(phase: UpdatePhase, message: string | null): void {
    readyPath = null;
    publish({ phase, availableVersion: null, notesUrl: null, message });
    void files.clear().catch((error: unknown) => {
      logger.warning('nettoyage du répertoire des mises à jour impossible', { error });
    });
  }

  async function check(): Promise<UpdateStatus> {
    if (!supported) {
      return status;
    }

    if (!isEnabled()) {
      if (status.phase !== 'disabled') {
        forget('disabled', null);
      }
      return status;
    }

    if (running) {
      return status;
    }

    running = true;
    publish({ phase: 'checking', message: null });

    try {
      const selection = await examine();

      switch (selection.kind) {
        case 'up-to-date':
          readyPath = null;
          publish({
            phase: 'idle',
            availableVersion: null,
            notesUrl: null,
            message: null,
            checkedAt: clock.now(),
          });
          break;

        case 'rejected':
          logger.warning('release écartée', { reason: selection.reason });
          publish({
            phase: 'error',
            message: `Mise à jour indisponible : ${selection.reason}.`,
            checkedAt: clock.now(),
          });
          break;

        case 'update':
          await download(selection.candidate);
          break;
      }
    } catch (error: unknown) {
      // Aucune exception ne sort d'ici. Le service tourne dans le processus qui
      // sert l'overlay : une promesse rejetée y serait au mieux du bruit, au
      // pire un arrêt.
      logger.warning('vérification de mise à jour impossible', { error });
      publish({
        phase: 'error',
        message: 'Impossible de contacter GitHub pour vérifier les mises à jour.',
        checkedAt: clock.now(),
      });
    } finally {
      running = false;
    }

    return status;
  }

  /** Interroge l'API et confronte la réponse au module de sélection. */
  async function examine() {
    const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;

    const response = await doFetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        // GitHub refuse les requêtes sans `User-Agent`. L'omettre ferait échouer
        // toutes les vérifications, avec un 403 qui ressemble à un quota.
        'User-Agent': `ChronoCast/${currentVersion}`,
      },
    });

    if (!response.ok) {
      return {
        kind: 'rejected' as const,
        reason: `GitHub a répondu ${String(response.status)}`,
      };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { kind: 'rejected' as const, reason: 'réponse illisible' };
    }

    return selectUpdate({ payload, currentVersion, owner, repo });
  }

  /**
   * Télécharge le condensat **puis** l'installeur, et vérifie avant d'écrire.
   *
   * L'ordre n'est pas anodin : chercher le condensat en premier évite de
   * télécharger cent mégaoctets pour découvrir ensuite qu'il n'y a rien à quoi
   * les comparer.
   */
  async function download(candidate: UpdateCandidate): Promise<void> {
    publish({
      phase: 'downloading',
      availableVersion: candidate.version,
      notesUrl: candidate.notesUrl,
      message: null,
      checkedAt: clock.now(),
    });

    const digestResponse = await doFetch(candidate.digestUrl);
    if (!digestResponse.ok) {
      failDownload(`condensat indisponible (${String(digestResponse.status)})`);
      return;
    }

    const expected = parseSha256File(await digestResponse.text(), candidate.installerName);
    if (expected === null) {
      failDownload('condensat publié illisible ou portant sur un autre fichier');
      return;
    }

    const ceiling = Math.min(Math.ceil(candidate.sizeBytes * SIZE_TOLERANCE), MAX_DOWNLOAD_BYTES);

    const installerResponse = await doFetch(candidate.installerUrl);
    if (!installerResponse.ok) {
      failDownload(`téléchargement refusé (${String(installerResponse.status)})`);
      return;
    }

    const bytes = new Uint8Array(await installerResponse.arrayBuffer());
    if (bytes.byteLength > ceiling) {
      failDownload('installeur plus volumineux que ce que la release annonce');
      return;
    }

    const actual = sha256Hex(bytes);
    if (actual !== expected) {
      // Le refus qui compte. Un installeur dont l'empreinte diffère est un
      // installeur qui n'est pas celui qui a été publié, et rien dans Windows
      // ne le dira à l'utilisateur à notre place.
      logger.error('condensat de mise à jour discordant', {
        version: candidate.version,
        expected,
        actual,
      });
      failDownload('l’empreinte du fichier téléchargé ne correspond pas à celle publiée');
      return;
    }

    readyPath = await files.save(candidate.installerName, bytes);

    logger.info('mise à jour prête à installer', { version: candidate.version });
    publish({ phase: 'ready', message: null });
  }

  function failDownload(reason: string): void {
    readyPath = null;
    logger.warning('mise à jour non retenue', { reason });
    publish({ phase: 'error', message: `Mise à jour non appliquée : ${reason}.` });
  }

  return {
    start(): void {
      if (!supported) {
        return;
      }

      if (!isEnabled()) {
        publish({ phase: 'disabled', message: null });
        return;
      }

      // Un `.exe` laissé là est celui d'une version déjà installée ; il pèse
      // une centaine de mégaoctets et ne resservira jamais.
      void files.clear().catch((error: unknown) => {
        logger.warning('nettoyage du répertoire des mises à jour impossible', { error });
      });

      // Retarder la première vérification : disputer le démarrage au service
      // de l'overlay pour aller interroger GitHub serait payer une commodité
      // avec ce que l'utilisateur attend réellement.
      arm(firstCheckDelayMs);
    },

    stop(): void {
      disarm();
    },

    check,

    install(): Promise<void> {
      if (installer === null) {
        return Promise.reject(new Error('Ce point d’entrée ne sait pas installer de mise à jour.'));
      }

      if (status.phase !== 'ready' || readyPath === null) {
        // Le panneau et le tray n'affichent le bouton que sur l'état `ready`,
        // mais l'API est atteignable directement : le refus vit ici, pas dans
        // la vue.
        return Promise.reject(new Error('Aucune mise à jour vérifiée n’est prête à être installée.'));
      }

      logger.info('lancement de l’installeur', { version: status.availableVersion });
      return installer.run(readyPath);
    },

    refresh(): void {
      if (!supported) {
        return;
      }

      if (!isEnabled()) {
        disarm();
        forget('disabled', null);
        return;
      }

      if (status.phase === 'disabled') {
        publish({ phase: 'idle', message: null });
        arm(firstCheckDelayMs);
      }
    },

    getStatus(): UpdateStatus {
      return status;
    },
  };
}
