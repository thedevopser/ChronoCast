/**
 * Câblage runtime commun aux deux points d'entrée.
 *
 * Le point d'entrée headless et la coquille Electron composent la même
 * application avec les mêmes briques Node : minuteurs, sockets, `fetch`,
 * temporisation. Seuls diffèrent les trois ports qui touchent réellement à la
 * plateforme — chemins, secrets, navigateur — et c'est là, et là seulement, que
 * les deux entrées doivent se distinguer.
 *
 * Ce module vit dans le noyau, aux côtés de `system-clock.ts` et
 * `system-ticker.ts`, pour la même raison qu'eux : il n'importe pas `electron`,
 * et il a deux appelants.
 *
 * **Tous les minuteurs sont `unref`és**, sans exception. Un minuteur qui retient
 * la boucle d'événements empêche le processus de se terminer : le battement de
 * vivacité du hub ferait alors traîner indéfiniment un arrêt propre, qui est
 * précisément le moment où l'on vide les journaux sur le disque.
 */

import type { Timers } from '../twitch/eventsub-client.js';
import type { EventSubSocketFactory } from '../twitch/eventsub-client.js';
import { createWebSocketFactory } from '../twitch/ws-socket-adapter.js';
import type { HubTimers } from '../server/ws-hub.js';

export interface NodeRuntime {
  /** Minuteurs du hub WebSocket. */
  readonly hubTimers: HubTimers;

  /** Minuteurs du client EventSub. */
  readonly eventSubTimers: Timers;

  /** Fabrique de sockets EventSub, adossée à `ws`. */
  readonly createSocket: EventSubSocketFactory;

  /** Implémentation de `fetch`, liée pour rester appelable détachée. */
  readonly fetch: typeof fetch;

  /** Temporisation entre deux tentatives Helix. */
  sleep(ms: number): Promise<void>;
}

export function createNodeRuntime(): NodeRuntime {
  return {
    hubTimers: {
      setInterval: (handler, ms) => {
        const timer = setInterval(handler, ms);
        timer.unref();
        // Le contrat expose un `number` pour rester indépendant de Node ; le
        // handle réel est un objet, que seul ce module manipule.
        return timer as unknown as number;
      },
      clearInterval: (id) => {
        clearInterval(id as unknown as NodeJS.Timeout);
      },
    },

    eventSubTimers: {
      setTimeout: (handler, ms) => {
        const timer = setTimeout(handler, ms);
        timer.unref();
        return timer as unknown as number;
      },
      clearTimeout: (id) => {
        clearTimeout(id as unknown as NodeJS.Timeout);
      },
    },

    createSocket: createWebSocketFactory(),

    // Lié : `fetch` lève une `TypeError` s'il est appelé sans son `this`
    // d'origine, et il est transmis ici comme une fonction ordinaire.
    fetch: globalThis.fetch.bind(globalThis),

    sleep: (ms) =>
      new Promise((done) => {
        setTimeout(done, ms).unref();
      }),
  };
}
