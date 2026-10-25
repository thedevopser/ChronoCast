import { describe, expect, it } from 'vitest';

import { createLogger } from '../../src/core/logging/logger.js';
import { createOAuthCallbackRouter, type OAuthOutcome } from '../../src/core/server/oauth-callback.js';
import { makeRequest } from '../helpers/http-request.js';

const STATE = 'a'.repeat(64);

describe('rappel OAuth forgé par une page tierce', () => {
  it('ne fait pas échouer la connexion en cours', async () => {
    let pending: string | null = STATE;
    const settled: OAuthOutcome[] = [];
    const exchanged: string[] = [];
    const router = createOAuthCallbackRouter({
      verifyState: (state) => {
        if (state !== pending) {
          return false;
        }
        pending = null;
        return true;
      },
      complete: (code) => {
        exchanged.push(code);
        return Promise.resolve();
      },
      getAppPort: () => 3_777,
      onSettled: (outcome) => settled.push(outcome),
      logger: createLogger({ level: 'error', sinks: [] }),
    });
    const callback = (query: Record<string, string>) =>
      makeRequest({ method: 'GET', path: '/callback', query, headers: { host: '127.0.0.1:37771' } });

    await router.handle(callback({ error: 'x' }));
    await router.handle(callback({ error: 'x', state: 'forgé' }));
    await router.handle(callback({ code: 'code-légitime', state: STATE }));

    expect(settled).toStrictEqual(['ok']);
    expect(exchanged).toStrictEqual(['code-légitime']);
  });
});
