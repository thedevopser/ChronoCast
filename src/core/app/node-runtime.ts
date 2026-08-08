import type { Timers } from '../twitch/eventsub-client.js';
import type { EventSubSocketFactory } from '../twitch/eventsub-client.js';
import { createWebSocketFactory } from '../twitch/ws-socket-adapter.js';
import type { HubTimers } from '../server/ws-hub.js';

export interface NodeRuntime {
  readonly hubTimers: HubTimers;

  readonly eventSubTimers: Timers;

  readonly createSocket: EventSubSocketFactory;

  readonly fetch: typeof fetch;

  sleep(ms: number): Promise<void>;
}

export function createNodeRuntime(): NodeRuntime {
  return {
    hubTimers: {
      setInterval: (handler, ms) => {
        const timer = setInterval(handler, ms);
        timer.unref();
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

    fetch: globalThis.fetch.bind(globalThis),

    sleep: (ms) =>
      new Promise((done) => {
        setTimeout(done, ms).unref();
      }),
  };
}
