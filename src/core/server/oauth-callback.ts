import type { Logger } from '../logging/logger.js';
import type { HttpRequest, HttpResponse } from './http-types.js';
import type { Router } from './router.js';

export const OAUTH_CALLBACK_PATH = '/callback';

const CALLBACK_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy': "default-src 'none'",
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
};

export interface OAuthCallbackOptions {
  readonly verifyState: (state: string) => boolean;

  readonly complete: (code: string) => Promise<void>;

  readonly getAppPort: () => number | null;

  readonly onSettled: (outcome: OAuthOutcome) => void;

  readonly logger: Logger;
}

export type OAuthOutcome = 'ok' | 'denied' | 'failed';

function textResponse(status: number, body: string): HttpResponse {
  return {
    status,
    headers: { ...CALLBACK_HEADERS, 'content-type': 'text/plain; charset=utf-8' },
    body,
  };
}

const TERMINAL_MESSAGES: Readonly<Record<OAuthOutcome, string>> = {
  ok: 'Connexion à Twitch réussie. Vous pouvez fermer cet onglet : la suite se passe dans ChronoCast.',
  denied: 'Autorisation refusée. Fermez cet onglet et réessayez depuis ChronoCast.',
  failed: "La connexion à Twitch n'a pas abouti. Fermez cet onglet et réessayez depuis ChronoCast.",
};

function terminalPage(outcome: OAuthOutcome, appPort: number | null): HttpResponse {
  const recourse =
    appPort === null
      ? ''
      : `<p><small><a href="http://127.0.0.1:${String(appPort)}/setup?oauth=${outcome}">Si ChronoCast ne réagit pas, poursuivre la configuration ici.</a></small></p>`;

  return {
    status: 200,
    headers: { ...CALLBACK_HEADERS, 'content-type': 'text/html; charset=utf-8' },
    body:
      `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>ChronoCast</title></head>` +
      `<body><p>${TERMINAL_MESSAGES[outcome]}</p>${recourse}</body></html>`,
  };
}

export function createOAuthCallbackRouter(options: OAuthCallbackOptions): Router {
  const scoped = options.logger.child('oauth-callback');

  function settle(outcome: OAuthOutcome): HttpResponse {
    options.onSettled(outcome);
    return terminalPage(outcome, options.getAppPort());
  }

  return {
    async handle(request: HttpRequest): Promise<HttpResponse> {
      if (request.path !== OAUTH_CALLBACK_PATH) {
        return textResponse(404, 'Ressource introuvable.');
      }

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return textResponse(405, 'Méthode non autorisée.');
      }

      if (request.query.has('error')) {
        scoped.info('autorisation refusée par l’utilisateur');
        return settle('denied');
      }

      const code = request.query.get('code');
      const state = request.query.get('state');

      if (code === null || code === '' || state === null || state === '') {
        return textResponse(400, 'Requête incomplète.');
      }

      if (!options.verifyState(state)) {
        scoped.warning('rappel OAuth refusé : state inattendu');
        return textResponse(403, 'Demande non reconnue.');
      }

      try {
        await options.complete(code);
      } catch (error: unknown) {
        scoped.error('échange du code d’autorisation impossible', { cause: error });
        return settle('failed');
      }

      scoped.info('connexion à Twitch établie');
      return settle('ok');
    },
  };
}
