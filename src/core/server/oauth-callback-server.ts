/**
 * Serveur éphémère du rappel OAuth.
 *
 * Il n'existe que pendant le flux d'autorisation : armé quand l'utilisateur
 * clique sur « Se connecter », éteint dès que le rappel est arrivé, et de toute
 * façon éteint au bout de cinq minutes. Passé ce délai, l'utilisateur a
 * abandonné, et ce qui reste à l'écoute n'est plus qu'une surface d'attaque
 * sans contrepartie.
 *
 * Le port est **fixe** et ne se replie pas, contrairement à celui du serveur
 * applicatif. Twitch exige que la redirect URI corresponde exactement à celle
 * déclarée dans la console développeur : se replier sur 37772 rendrait le
 * rappel introuvable, ce qui serait bien plus déroutant qu'une erreur franche.
 *
 * Le serveur sous-jacent et les minuteurs sont injectés — mêmes raisons que
 * partout ailleurs dans le noyau : aucun socket ouvert ni aucune attente réelle
 * dans les tests.
 */

import type { Logger } from '../logging/logger.js';
import type { Router } from './router.js';

/**
 * Durée de vie d'un flux d'autorisation.
 *
 * Cinq minutes : le temps de lire une page de consentement Twitch, de se
 * connecter si besoin, et de valider. Au-delà, l'utilisateur a fermé l'onglet.
 */
export const OAUTH_CALLBACK_TTL_MS = 300_000;

/** Surface minimale d'un serveur HTTP, réduite à ce dont ce module a besoin. */
export interface ArmableServer {
  start(): Promise<number>;
  stop(): Promise<void>;
}

export interface TimerPort {
  setTimeout(run: () => void, delayMs: number): number;
  clearTimeout(id: number): void;
}

export interface OAuthCallbackServerOptions {
  readonly router: Router;
  readonly createServer: (router: Router) => ArmableServer;
  readonly timers: TimerPort;
  readonly logger: Logger;
  readonly ttlMs?: number;
}

export interface OAuthCallbackServer {
  /** Ouvre le port pour la durée du flux. Réarmer relance le délai. */
  arm(): Promise<void>;
  /** Ferme le port et annule l'expiration. Sans effet s'il est déjà fermé. */
  disarm(): Promise<void>;
  isArmed(): boolean;
}

export function createOAuthCallbackServer(
  options: OAuthCallbackServerOptions,
): OAuthCallbackServer {
  const ttlMs = options.ttlMs ?? OAUTH_CALLBACK_TTL_MS;
  const scoped = options.logger.child('oauth-callback');

  let server: ArmableServer | null = null;
  let expiryTimer: number | null = null;

  function cancelExpiry(): void {
    if (expiryTimer !== null) {
      options.timers.clearTimeout(expiryTimer);
      expiryTimer = null;
    }
  }

  async function stop(): Promise<void> {
    cancelExpiry();

    const running = server;
    server = null;
    if (running !== null) {
      await running.stop();
    }
  }

  function scheduleExpiry(): void {
    cancelExpiry();
    expiryTimer = options.timers.setTimeout(() => {
      expiryTimer = null;
      scoped.info('flux d’autorisation expiré : port de rappel refermé');
      void stop().catch((error: unknown) => {
        scoped.error('fermeture du port de rappel impossible', { cause: error });
      });
    }, ttlMs);
  }

  return {
    async arm(): Promise<void> {
      // Un second clic sur « Se connecter » ne doit pas ouvrir un second port :
      // il relance simplement le compte à rebours.
      if (server !== null) {
        scheduleExpiry();
        return;
      }

      const created = options.createServer(options.router);
      // Le port n'est publié qu'une fois l'écoute effective : sinon un échec
      // laisserait le module se croire armé.
      await created.start();
      server = created;
      scheduleExpiry();
    },

    disarm(): Promise<void> {
      return stop();
    },

    isArmed(): boolean {
      return server !== null;
    },
  };
}
