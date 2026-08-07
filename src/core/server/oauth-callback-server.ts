import type { Logger } from '../logging/logger.js';
import type { Router } from './router.js';

export const OAUTH_CALLBACK_TTL_MS = 300_000;

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
  arm(): Promise<void>;
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
      if (server !== null) {
        scheduleExpiry();
        return;
      }

      const created = options.createServer(options.router);
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
