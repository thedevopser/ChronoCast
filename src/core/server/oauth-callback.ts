/**
 * Rappel du flux d'autorisation Twitch.
 *
 * Twitch renvoie l'utilisateur sur `http://127.0.0.1:37771/callback`, avec un
 * code d'autorisation qui s'échange contre un jeton d'accès à la chaîne. C'est
 * le seul point de ChronoCast où un navigateur extérieur au produit pousse une
 * requête dans l'application : ce fichier garde la porte.
 *
 * Redirect URI à port fixe, décision de la Phase 4 : Twitch exige une
 * correspondance **exacte** avec ce qui est déclaré dans la console
 * développeur, or le port du serveur applicatif est configurable et peut se
 * replier s'il est déjà pris. Les deux ne pouvaient pas être le même.
 *
 * Le gestionnaire est une fonction pure de requête vers réponse, comme tout le
 * routage de la Phase 4. L'adaptateur `node:http` et le cycle de vie du serveur
 * éphémère vivent ailleurs.
 *
 * ## Ce que ce module ne sait pas
 *
 * **Il ne voit jamais le `state` attendu.** Il ne reçoit qu'un `verifyState()`
 * qui répond oui ou non. Il ne peut donc ni le journaliser, ni le renvoyer dans
 * une page, ni le laisser fuir dans une URL de redirection. La comparaison à
 * temps constant se fait chez l'appelant, qui réutilise `verifyCsrfToken` — le
 * `state` a exactement la forme d'un jeton CSRF, trente-deux octets en
 * hexadécimal, parce qu'il est engendré par la même fabrique.
 *
 * **Il ne voit jamais le secret client.** L'échange est délégué à `complete()`.
 */

import type { Logger } from '../logging/logger.js';
import type { HttpRequest, HttpResponse } from './http-types.js';
import type { Router } from './router.js';

/** Chemin du rappel, moitié fixe de l'URI déclarée chez Twitch. */
export const OAUTH_CALLBACK_PATH = '/callback';

/**
 * En-têtes de toutes les réponses du serveur éphémère.
 *
 * `default-src 'none'` et non `'self'` : ce serveur ne sert aucune ressource,
 * ni style, ni script, ni image. Il affiche au plus une page de repli en texte
 * balisé, puis s'éteint. Autant fermer complètement.
 */
const CALLBACK_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy': "default-src 'none'",
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
};

export interface OAuthCallbackOptions {
  /**
   * Vérifie le `state` reçu.
   *
   * **Ne consomme la demande en cours qu'en cas de correspondance.** N'importe
   * quelle page distante peut provoquer une navigation vers la boucle locale ;
   * si un `state` erroné suffisait à clore le flux, le premier venu pourrait
   * faire échouer la connexion du streamer, à distance et en boucle.
   */
  readonly verifyState: (state: string) => boolean;

  /** Échange le code contre un jeton, puis met la connexion Twitch en route. */
  readonly complete: (code: string) => Promise<void>;

  /** Port du serveur applicatif, pour le lien de repli vers l'assistant. */
  readonly getAppPort: () => number | null;

  /**
   * Le flux est terminé, quel qu'en soit le résultat.
   *
   * Deux conséquences, et elles sont de nature différente : le serveur
   * éphémère n'a plus rien à écouter, et la coquille Electron doit ramener sa
   * fenêtre au premier plan. L'issue est transmise parce que la seconde en
   * dépend — un refus doit ramener la fenêtre autant qu'une réussite.
   */
  readonly onSettled: (outcome: OAuthOutcome) => void;

  readonly logger: Logger;
}

/** Issue du flux, telle qu'elle parvient à l'assistant. Codes stables et clos. */
export type OAuthOutcome = 'ok' | 'denied' | 'failed';

function textResponse(status: number, body: string): HttpResponse {
  return {
    status,
    headers: { ...CALLBACK_HEADERS, 'content-type': 'text/plain; charset=utf-8' },
    body,
  };
}

/** Message affiché au navigateur, un par issue. Textes constants. */
const TERMINAL_MESSAGES: Readonly<Record<OAuthOutcome, string>> = {
  ok: 'Connexion à Twitch réussie. Vous pouvez fermer cet onglet : la suite se passe dans ChronoCast.',
  denied: 'Autorisation refusée. Fermez cet onglet et réessayez depuis ChronoCast.',
  failed: "La connexion à Twitch n'a pas abouti. Fermez cet onglet et réessayez depuis ChronoCast.",
};

/**
 * Page terminale du navigateur.
 *
 * Elle a d'abord été une redirection vers `/setup`, ce qui était juste tant que
 * le navigateur était la seule interface. Depuis la coquille Electron, cette
 * redirection faisait **poursuivre la configuration dans le navigateur**
 * pendant que la fenêtre de l'application restait à l'étape précédente : deux
 * assistants ouverts, et l'utilisateur qui termine dans le mauvais. Le
 * navigateur a fait sa part — il rapporte l'issue et s'arrête là.
 *
 * Le lien vers l'assistant subsiste pour le point d'entrée headless, où il n'y
 * a pas de fenêtre et où cette page est le seul retour. Il est présenté comme
 * un recours, pas comme la suite du parcours : dans l'application, le suivre
 * ramènerait exactement le défaut qu'on vient de corriger.
 *
 * Sans style et sans script : la CSP de ce serveur n'autorise rien, et une page
 * lue quelques secondes avant d'être fermée n'a pas besoin d'être belle. Seul
 * un code d'issue transite — jamais le code d'autorisation, jamais un message
 * d'erreur de Twitch, qui est du texte contrôlé par un tiers.
 */
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

      // Twitch redirige un navigateur : c'est un GET, et rien d'autre.
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return textResponse(405, 'Méthode non autorisée.');
      }

      // `error=access_denied` quand l'utilisateur clique sur « Annuler ». Ce
      // n'est pas une anomalie, c'est une décision : on la respecte sans bruit.
      if (request.query.has('error')) {
        scoped.info('autorisation refusée par l’utilisateur');
        return settle('denied');
      }

      const code = request.query.get('code');
      const state = request.query.get('state');

      if (code === null || code === '' || state === null || state === '') {
        // Ni `settle`, ni journal détaillé : une requête tronquée n'apprend
        // rien et ne doit pas clore un flux légitime en cours.
        return textResponse(400, 'Requête incomplète.');
      }

      if (!options.verifyState(state)) {
        scoped.warning('rappel OAuth refusé : state inattendu');
        return textResponse(403, 'Demande non reconnue.');
      }

      try {
        await options.complete(code);
      } catch (error: unknown) {
        // Le détail appartient aux journaux, pas à une barre d'adresse. Le flux
        // est clos malgré tout : un code d'autorisation est à usage unique, le
        // rejouer échouerait, et laisser le serveur armé n'offrirait qu'une
        // surface d'attaque de plus.
        scoped.error('échange du code d’autorisation impossible', { cause: error });
        return settle('failed');
      }

      scoped.info('connexion à Twitch établie');
      return settle('ok');
    },
  };
}
