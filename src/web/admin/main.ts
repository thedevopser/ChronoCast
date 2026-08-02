/**
 * Point d'entrée du panneau d'administration.
 *
 * Ce fichier n'est **que du câblage**, comme `overlay/main.ts` et
 * `setup/main.ts`. Il ne décide rien : la navigation est arbitrée par
 * `router.ts`, le contenu par `dashboard-model.ts`, le décompte par
 * `countdown.ts`, les appels par `api-client.ts`, l'écriture dans le DOM par
 * `safe-dom.ts` — tous couverts par des tests. Ce qui reste ici — obtenir des
 * éléments, accrocher des gestionnaires, demander une image — n'est pas
 * vérifiable sans navigateur et n'a rien à décider.
 *
 * Aucun `console` : ESLint l'interdit dans `src/web`, et un incident se
 * diagnostique par les journaux du serveur, que ce panneau montrera.
 */

import { createApiClient, readCsrfToken, ApiError } from '../shared/api-client.js';
import { createCountdown, type SyncMode } from '../shared/countdown.js';
import {
  clearChildren,
  requireElement,
  setText,
  MAX_TEXT_LENGTH,
} from '../shared/safe-dom.js';
import { formatRemaining, formatReward } from '../shared/time-format.js';
import {
  DEFAULT_CHANNELS,
  type CounterChangeOrigin,
  type CounterState,
  type DomainEventType,
  type ServerMessage,
} from '../shared/protocol.js';
import { createWsClient, type WsClientStatus, type WsSocket } from '../shared/ws-client.js';
import { readWebSocketPort, resolveWebSocketUrl } from '../shared/ws-url.js';
import {
  applyMessage,
  counterControls,
  createDashboardModel,
  EVENT_LABELS,
  statusLabel,
  twitchLabel,
  type DashboardModel,
} from './dashboard-model.js';
import { ADMIN_VIEWS, hashForView, viewFromHash, VIEW_LABELS, type AdminViewId } from './router.js';

/** Pastille de liaison, par état du client WebSocket. */
const LINK_CLASSES: Readonly<Record<WsClientStatus, string>> = {
  connecting: 'dot dot--warning',
  open: 'dot dot--ok',
  reconnecting: 'dot dot--warning',
  stopped: 'dot dot--danger',
};

/** Pastille du compteur, par statut. */
const COUNTER_PILLS: Readonly<Record<CounterState['status'], string>> = {
  idle: 'pill',
  running: 'pill pill--ok',
  paused: 'pill pill--warning',
  finished: 'pill pill--danger',
};

/**
 * Adaptateur du `WebSocket` du navigateur vers le port attendu par le client.
 *
 * Identique à celui de l'overlay : il déplie `MessageEvent.data` pour que
 * `ws-client` n'ait pas à connaître le DOM.
 */
function createBrowserSocket(url: string): WsSocket {
  const native = new WebSocket(url);

  const port: WsSocket = {
    send: (data: string) => {
      native.send(data);
    },
    close: () => {
      native.close();
    },
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };

  native.addEventListener('open', () => port.onopen?.());
  native.addEventListener('message', (event: MessageEvent<unknown>) => port.onmessage?.(event.data));
  native.addEventListener('close', () => port.onclose?.());
  native.addEventListener('error', () => port.onerror?.());

  return port;
}

function start(): void {
  const api = createApiClient({
    token: readCsrfToken(document),
    fetch: (input, init) => window.fetch(input, init),
  });

  const banner = requireElement(document, '#banner');
  const nav = requireElement(document, '#nav');
  const linkState = requireElement(document, '#link-state');
  const counterElement = requireElement(document, '#counter');
  const eventsList = requireElement(document, '#events');
  const eventsEmpty = requireElement(document, '#events-empty');

  const input = (selector: string): HTMLInputElement =>
    requireElement(document, selector) as HTMLInputElement;
  const button = (selector: string): HTMLButtonElement =>
    requireElement(document, selector) as HTMLButtonElement;

  const countdown = createCountdown();
  let model: DashboardModel = createDashboardModel();
  let painted: DashboardModel | null = null;
  let renderedCountdown = '';

  /* ---------------------------------------------------------------------- */
  /* Bandeau                                                                */
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

  /** Neutralise le bouton le temps de l'appel : un double clic vaut deux actions. */
  async function guarded(target: HTMLButtonElement, action: () => Promise<void>): Promise<void> {
    target.disabled = true;
    try {
      await action();
      banner.hidden = true;
    } catch (error: unknown) {
      reportFailure(error);
    } finally {
      target.disabled = false;
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Navigation                                                             */
  /* ---------------------------------------------------------------------- */

  function showView(view: AdminViewId): void {
    // Élargi en `readonly string[]` : tant que la liste ne compte qu'une vue,
    // TypeScript réduit la comparaison à une constante et ESLint la signale
    // comme morte. Elle ne l'est que le temps du lot 1.
    for (const candidate of ADMIN_VIEWS as readonly string[]) {
      requireElement(document, `#view-${candidate}`).hidden = candidate !== view;
    }

    for (const item of nav.querySelectorAll('a')) {
      const target = item.dataset['view'];
      if (target === view) {
        item.setAttribute('aria-current', 'page');
      } else {
        item.removeAttribute('aria-current');
      }
    }
  }

  function buildNav(): void {
    clearChildren(nav);

    for (const view of ADMIN_VIEWS) {
      const item = document.createElement('a');
      item.className = 'nav__item';
      item.href = hashForView(view);
      item.dataset['view'] = view;
      setText(item, VIEW_LABELS[view]);
      nav.append(item);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Peinture                                                               */
  /* ---------------------------------------------------------------------- */

  function paintEvents(): void {
    clearChildren(eventsList);
    eventsEmpty.hidden = model.events.length > 0;

    for (const event of model.events) {
      const item = document.createElement('li');
      item.className = event.applied ? 'event' : 'event event--skipped';

      const type = document.createElement('span');
      type.className = 'event__type';
      setText(type, EVENT_LABELS[event.type]);

      // Le pseudo vient de Twitch, donc d'un inconnu : `setText` tronque,
      // retire les caractères de contrôle et n'interprète jamais de HTML.
      const user = document.createElement('span');
      user.className = 'event__user';
      setText(user, event.userName);

      const reward = document.createElement('span');
      reward.className = 'event__reward';
      setText(reward, event.applied ? formatReward(event.rewardSeconds) : 'non crédité');

      item.append(type, user, reward);
      eventsList.append(item);
    }
  }

  function paint(): void {
    if (painted === model) {
      return;
    }

    const counter = model.counter;

    if (counter !== null) {
      const pill = requireElement(document, '#counter-status');
      setText(pill, statusLabel(counter.status));
      pill.className = COUNTER_PILLS[counter.status];

      setText(
        requireElement(document, '#counter-detail'),
        `Départ ${formatReward(Math.round(counter.initialMs / 1_000))} · ` +
          `ajouté ${formatReward(Math.round(counter.totalAddedMs / 1_000))}`,
        120,
      );

      const controls = counterControls(counter);
      button('#pause').disabled = !controls.canPause;
      button('#resume').disabled = !controls.canResume;
      button('#reset').disabled = !controls.canReset;
    }

    const twitchPill = requireElement(document, '#twitch-status');
    setText(twitchPill, twitchLabel(model.twitch.status));
    twitchPill.className =
      model.twitch.status === 'ready' || model.twitch.status === 'connected'
        ? 'pill pill--ok'
        : 'pill pill--warning';
    setText(requireElement(document, '#twitch-detail'), model.twitch.detail, 200);

    setText(requireElement(document, '#app-version'), model.appVersion, 32);

    paintEvents();
    painted = model;
  }

  /** Une érosion de routine se rattrape ; tout le reste s'impose. */
  function syncModeOf(origin: CounterChangeOrigin): SyncMode {
    return origin === 'tick' ? 'tick' : 'authoritative';
  }

  function handle(message: ServerMessage): void {
    switch (message.type) {
      case 'state':
        countdown.sync(message.counter, performance.now(), 'authoritative');
        break;
      case 'counter':
        countdown.sync(message.state, performance.now(), syncModeOf(message.origin));
        break;

      case 'hello':
      case 'twitch:status':
      case 'event':
      case 'config':
      case 'log':
      case 'pong':
      case 'error':
        // Rien à resynchroniser : ces messages n'affectent que le modèle, qui
        // les reçoit juste en dessous.
        break;
    }

    model = applyMessage(model, message);
    paint();
  }

  function render(): void {
    const text = formatRemaining(countdown.remainingAt(performance.now()), {
      showDays: true,
      hideEmptyHours: false,
    });

    if (text !== renderedCountdown) {
      setText(counterElement, text, MAX_TEXT_LENGTH);
      renderedCountdown = text;
    }

    window.requestAnimationFrame(render);
  }

  /* ---------------------------------------------------------------------- */
  /* Actions                                                                */
  /* ---------------------------------------------------------------------- */

  /** Rejoue l'état renvoyé par une mutation, sans attendre la diffusion. */
  function adopt(state: CounterState | undefined): void {
    if (state !== undefined) {
      countdown.sync(state, performance.now(), 'authoritative');
      model = applyMessage(model, { type: 'counter', state, origin: 'manual', deltaMs: 0, reason: '' });
      paint();
    }
  }

  for (const [selector, path] of [
    ['#pause', '/api/counter/pause'],
    ['#resume', '/api/counter/resume'],
    ['#reset', '/api/counter/reset'],
  ] as const) {
    const control = button(selector);
    control.addEventListener('click', () => {
      void guarded(control, async () => {
        const result = await api.post<{ counter: CounterState }>(path);
        adopt(result?.counter);
      });
    });
  }

  for (const [selector, path, fallback] of [
    ['#add-time', '/api/counter/add', 'ajout manuel'],
    ['#remove-time', '/api/counter/remove', 'retrait manuel'],
  ] as const) {
    const control = button(selector);
    control.addEventListener('click', () => {
      void guarded(control, async () => {
        const reason = input('#adjust-reason').value.trim();
        const result = await api.post<{ counter: CounterState }>(path, {
          seconds: Number(input('#adjust-seconds').value),
          reason: reason === '' ? fallback : reason,
        });
        adopt(result?.counter);
      });
    });
  }

  const saveInitial = button('#save-initial');
  saveInitial.addEventListener('click', () => {
    void guarded(saveInitial, async () => {
      const hours = Number(input('#initial-hours').value);
      const result = await api.post<{ counter: CounterState }>('/api/counter/initial', {
        seconds: Math.round(hours * 3_600),
      });
      adopt(result?.counter);
    });
  });

  for (const control of document.querySelectorAll('[data-test-event]')) {
    const target = control as HTMLButtonElement;
    target.addEventListener('click', () => {
      void guarded(target, async () => {
        await api.post('/api/overlay/test', { type: target.dataset['testEvent'] as DomainEventType });
      });
    });
  }

  for (const control of document.querySelectorAll('[data-copy]')) {
    control.addEventListener('click', () => {
      const sourceId = control.getAttribute('data-copy');
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

  /* ---------------------------------------------------------------------- */
  /* Démarrage                                                              */
  /* ---------------------------------------------------------------------- */

  buildNav();
  showView(viewFromHash(window.location.hash));
  window.addEventListener('hashchange', () => {
    showView(viewFromHash(window.location.hash));
  });

  setText(requireElement(document, '#overlay-url'), `${window.location.origin}/overlay`, 200);

  const client = createWsClient({
    url: resolveWebSocketUrl({
      host: window.location.host,
      protocol: window.location.protocol,
      port: readWebSocketPort(document),
    }),
    // Le panneau prend tout : il montre le compteur, les événements, le statut
    // Twitch, et — dès le lot 3 — les journaux au fil de l'eau.
    channels: DEFAULT_CHANNELS,
    createSocket: createBrowserSocket,
    onMessage: handle,
    onStatusChange: (status) => {
      linkState.className = LINK_CLASSES[status];
    },
    timers: {
      setTimeout: (run, delay) => window.setTimeout(run, delay),
      clearTimeout: (id) => {
        window.clearTimeout(id);
      },
    },
  });

  // La valeur de départ n'est pas dans l'instantané du WebSocket : elle vit
  // dans la configuration, qui se lit par l'API.
  void api.get<{ config: { counter: { initialSeconds: number } } }>('/api/config').then(
    ({ config }) => {
      input('#initial-hours').value = String(config.counter.initialSeconds / 3_600);
    },
    (error: unknown) => {
      reportFailure(error);
    },
  );

  client.start();
  window.requestAnimationFrame(render);
}

start();
