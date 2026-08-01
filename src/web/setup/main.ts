/**
 * Point d'entrée de l'assistant de première configuration.
 *
 * Ce fichier n'est que du câblage. La progression est décidée par `wizard.ts`,
 * les appels par `api-client.ts`, l'écriture dans le DOM par `safe-dom.ts` —
 * tous trois couverts par des tests. Ce qui reste ici — lire des champs,
 * accrocher des gestionnaires, montrer une section — n'est pas vérifiable sans
 * navigateur et n'a rien à décider.
 *
 * Aucun `console` : ESLint l'interdit dans `src/web`, et un incident se
 * diagnostique par les journaux du serveur, visibles depuis le panneau.
 */

import { ApiError, createApiClient, readCsrfToken } from '../shared/api-client.js';
import { clearChildren, requireElement, setText } from '../shared/safe-dom.js';
import { isStepReachable, resumeStep, SETUP_STEPS, type SetupStepId } from './wizard.js';

/** Libellés du fil d'étapes. */
const STEP_LABELS: Readonly<Record<SetupStepId, string>> = {
  intro: 'Application Twitch',
  credentials: 'Identifiants',
  connect: 'Connexion',
  channel: 'Chaîne',
  counter: 'Compteur',
  overlay: 'Overlay',
};

/**
 * Issues du rappel OAuth, telles que le serveur éphémère les renvoie.
 *
 * Codes clos et non un message : ce qui transite par une barre d'adresse ne
 * doit jamais venir de Twitch, dont les textes sont contrôlés par un tiers.
 */
const OAUTH_MESSAGES: Readonly<Record<string, { text: string; kind: string }>> = {
  ok: { text: 'Connexion à Twitch réussie.', kind: 'banner--success' },
  denied: { text: 'Vous avez refusé l’autorisation. Vous pouvez réessayer.', kind: 'banner--error' },
  failed: {
    text: 'La connexion a échoué. Vérifiez le Client ID et le secret, puis réessayez.',
    kind: 'banner--error',
  },
};

interface TwitchStatus {
  readonly broadcasterLogin: string;
  readonly clientId: string;
  readonly hasClientSecret: boolean;
  readonly connected: boolean;
  readonly missingScopes: readonly string[];
}

interface ConfigPayload {
  readonly config: {
    readonly counter: { readonly initialSeconds: number };
    readonly rewards: {
      readonly sub: { readonly prime: number; readonly tier1: number; readonly tier2: number; readonly tier3: number };
      readonly bits: { readonly linear: { readonly unit: number; readonly secondsPerUnit: number } };
    };
    readonly setup: { readonly completed: boolean };
  };
}

function start(): void {
  const api = createApiClient({
    token: readCsrfToken(document),
    fetch: (input, init) => window.fetch(input, init),
  });

  const stepsNav = requireElement(document, '#steps');
  const banner = requireElement(document, '#banner');
  const resumeHint = requireElement(document, '#resume-hint');

  const input = (selector: string): HTMLInputElement =>
    requireElement(document, selector) as HTMLInputElement;

  let status: TwitchStatus = {
    broadcasterLogin: '',
    clientId: '',
    hasClientSecret: false,
    connected: false,
    missingScopes: [],
  };
  let completed = false;
  let visible: SetupStepId = 'intro';

  /* ---------------------------------------------------------------------- */
  /* Affichage                                                              */
  /* ---------------------------------------------------------------------- */

  function showBanner(text: string, kind: string): void {
    setText(banner, text, 200);
    banner.className = `banner ${kind}`;
    banner.hidden = false;
  }

  function reportFailure(error: unknown): void {
    // `ApiError` porte déjà la phrase française écrite par le serveur : la
    // remplacer par un message générique gâcherait tout le soin mis en amont.
    const message =
      error instanceof ApiError ? error.message : 'Une erreur inattendue est survenue.';
    showBanner(message, 'banner--error');
  }

  function renderSteps(): void {
    clearChildren(stepsNav);

    SETUP_STEPS.forEach((step, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'steps__item';
      item.disabled = !isStepReachable(step, { ...status, completed });
      if (step === visible) {
        item.setAttribute('aria-current', 'step');
      }

      const badge = document.createElement('span');
      badge.className = 'steps__index';
      setText(badge, String(index + 1));

      const label = document.createElement('span');
      setText(label, STEP_LABELS[step]);

      item.append(badge, label);
      item.addEventListener('click', () => {
        show(step);
      });
      stepsNav.append(item);
    });
  }

  function show(step: SetupStepId): void {
    visible = step;
    for (const candidate of SETUP_STEPS) {
      requireElement(document, `#step-${candidate}`).hidden = candidate !== step;
    }
    renderSteps();
  }

  function renderChannel(): void {
    setText(requireElement(document, '#broadcaster-login'), status.broadcasterLogin);

    const hasAll = status.missingScopes.length === 0;
    requireElement(document, '#scopes-ok').hidden = !hasAll;
    requireElement(document, '#scopes-missing').hidden = hasAll;

    const list = requireElement(document, '#missing-scopes');
    clearChildren(list);
    for (const scope of status.missingScopes) {
      const item = document.createElement('li');
      setText(item, scope);
      list.append(item);
    }
  }

  function renderOverlayUrl(): void {
    setText(
      requireElement(document, '#overlay-url'),
      `${window.location.origin}/overlay`,
      200,
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Chargement de l'état                                                   */
  /* ---------------------------------------------------------------------- */

  async function refresh(): Promise<void> {
    status = await api.get<TwitchStatus>('/api/twitch/status');
    const { config } = await api.get<ConfigPayload>('/api/config');
    completed = config.setup.completed;

    input('#client-id').value = status.clientId;
    setText(
      requireElement(document, '#secret-hint'),
      status.hasClientSecret
        ? 'Un secret est déjà enregistré. Laissez vide pour le conserver.'
        : 'Aucun secret enregistré pour l’instant.',
    );

    input('#initial-hours').value = String(config.counter.initialSeconds / 3_600);
    input('#reward-prime').value = String(config.rewards.sub.prime);
    input('#reward-tier1').value = String(config.rewards.sub.tier1);
    input('#reward-tier2').value = String(config.rewards.sub.tier2);
    input('#reward-tier3').value = String(config.rewards.sub.tier3);
    input('#reward-bits').value = String(config.rewards.bits.linear.secondsPerUnit);

    renderChannel();
    renderOverlayUrl();
  }

  /** Neutralise le bouton le temps de l'appel : un double clic vaut deux flux. */
  async function guarded(button: HTMLButtonElement, action: () => Promise<void>): Promise<void> {
    button.disabled = true;
    try {
      await action();
    } catch (error: unknown) {
      reportFailure(error);
    } finally {
      button.disabled = false;
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Actions                                                                */
  /* ---------------------------------------------------------------------- */

  for (const element of document.querySelectorAll('[data-goto]')) {
    element.addEventListener('click', () => {
      const target = element.getAttribute('data-goto');
      if (target !== null) {
        show(target as SetupStepId);
      }
    });
  }

  for (const element of document.querySelectorAll('[data-copy]')) {
    element.addEventListener('click', () => {
      const sourceId = element.getAttribute('data-copy');
      if (sourceId === null) {
        return;
      }
      const text = requireElement(document, `#${sourceId}`).textContent;
      void navigator.clipboard.writeText(text).then(
        () => {
          showBanner('Adresse copiée.', 'banner--success');
        },
        () => {
          showBanner('Copie impossible : sélectionnez le texte à la main.', 'banner--error');
        },
      );
    });
  }

  const saveCredentials = requireElement(document, '#save-credentials') as HTMLButtonElement;
  saveCredentials.addEventListener('click', () => {
    void guarded(saveCredentials, async () => {
      const clientId = input('#client-id').value.trim();
      const clientSecret = input('#client-secret').value;

      // Le secret est **frère** de `config` dans le corps, jamais son enfant :
      // il va dans le magasin chiffré et ne ressort par aucune lecture.
      await api.patch('/api/config', {
        config: { twitch: { clientId } },
        ...(clientSecret === '' ? {} : { clientSecret }),
      });

      input('#client-secret').value = '';
      await refresh();
      show(resumeStep({ ...status, completed }));
    });
  });

  const connect = requireElement(document, '#connect') as HTMLButtonElement;
  const reconnect = requireElement(document, '#reconnect') as HTMLButtonElement;

  function beginAuthorization(button: HTMLButtonElement): void {
    void guarded(button, async () => {
      const result = await api.post<{ authorizationUrl: string }>('/api/twitch/connect');
      if (result !== null) {
        // Navigation dans le même onglet : une fenêtre séparée serait bloquée
        // par le navigateur, le clic étant déjà consommé par l'appel réseau.
        window.location.assign(result.authorizationUrl);
      }
    });
  }

  connect.addEventListener('click', () => {
    beginAuthorization(connect);
  });
  reconnect.addEventListener('click', () => {
    beginAuthorization(reconnect);
  });

  const saveCounter = requireElement(document, '#save-counter') as HTMLButtonElement;
  saveCounter.addEventListener('click', () => {
    void guarded(saveCounter, async () => {
      const hours = Number(input('#initial-hours').value);

      await api.patch('/api/config', {
        config: {
          counter: { initialSeconds: Math.round(hours * 3_600) },
          rewards: {
            sub: {
              prime: Number(input('#reward-prime').value),
              tier1: Number(input('#reward-tier1').value),
              tier2: Number(input('#reward-tier2').value),
              tier3: Number(input('#reward-tier3').value),
            },
            bits: { linear: { secondsPerUnit: Number(input('#reward-bits').value) } },
          },
          // Marque la fin de l'assistant. C'est la seule chose que la
          // progression ne sait pas déduire de l'état réel.
          setup: { completed: true },
        },
      });

      await refresh();
      show('overlay');
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Démarrage                                                              */
  /* ---------------------------------------------------------------------- */

  const outcome = new URLSearchParams(window.location.search).get('oauth');
  const announced = outcome === null ? undefined : OAUTH_MESSAGES[outcome];
  if (announced !== undefined) {
    showBanner(announced.text, announced.kind);
    // L'issue est retirée de l'URL : un rechargement ne doit pas rejouer le
    // message d'une opération qui date.
    window.history.replaceState(null, '', window.location.pathname);
  }

  void refresh().then(
    () => {
      const step = resumeStep({ ...status, completed });
      setText(
        resumeHint,
        completed
          ? 'Configuration terminée. Vous pouvez la reprendre à tout moment.'
          : 'Reprise là où vous vous étiez arrêté.',
        200,
      );
      show(step);
    },
    (error: unknown) => {
      reportFailure(error);
      show('intro');
    },
  );
}

start();
