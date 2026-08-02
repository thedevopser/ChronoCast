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
import { normalizeTiers, type TierInput } from './bits-tiers.js';
import {
  applyMessage,
  counterControls,
  createDashboardModel,
  EVENT_LABELS,
  statusLabel,
  twitchLabel,
  type DashboardModel,
} from './dashboard-model.js';
import { fieldsOf, groupsOf } from './fields.js';
import { patchFrom, valuesFrom, type FieldError } from './form-binding.js';
import {
  clearFieldErrors,
  readFieldValues,
  renderFieldGroups,
  showFieldErrors,
  writeFieldValues,
} from './render-fields.js';
import {
  ADMIN_VIEWS,
  FIELD_VIEWS,
  hashForView,
  viewFromHash,
  VIEW_LABELS,
  type AdminViewId,
  type FieldViewId,
} from './router.js';

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

/** Ce que `GET /api/twitch/status` renvoie, réduit à ce que la vue affiche. */
interface TwitchDescription {
  readonly broadcasterLogin: string;
  readonly clientId: string;
  readonly hasClientSecret: boolean;
  readonly connected: boolean;
  readonly scopes: readonly string[];
  readonly missingScopes: readonly string[];
}

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
    // Le bandeau est effacé **avant** l'action, jamais après : l'effacer après
    // emporterait le message que l'action vient elle-même d'afficher.
    banner.hidden = true;
    try {
      await action();
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
    for (const candidate of ADMIN_VIEWS as readonly string[]) {
      requireElement(document, `#view-${candidate}`).hidden = candidate !== view;
    }

    // L'aperçu n'est chargé qu'à la première ouverture de la vue Apparence :
    // le charger d'emblée ouvrirait une seconde connexion WebSocket qui
    // resterait en vie tout le direct, pour un cadre que personne ne regarde.
    if (view === 'appearance') {
      const preview = requireElement(document, '#overlay-preview') as HTMLIFrameElement;
      if (preview.getAttribute('src') === null) {
        preview.src = '/overlay';
      }
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
  /* Vues de réglage                                                        */
  /* ---------------------------------------------------------------------- */

  /** Dernière configuration connue, référence de comparaison des saisies. */
  let config: unknown = {};

  const containerOf = (view: FieldViewId): HTMLElement =>
    requireElement(document, `#fields-${view}`);

  const tiersList = requireElement(document, '#bits-tiers');

  /** Ajoute une ligne à l'éditeur de paliers. */
  function appendTierRow(minBits: string, seconds: string): void {
    const row = document.createElement('li');
    row.className = 'tier';

    const makeField = (label: string, value: string, role: string): HTMLElement => {
      const wrapper = document.createElement('label');
      wrapper.className = 'field field--compact';

      const caption = document.createElement('span');
      caption.className = 'field__label';
      setText(caption, label);

      const input = document.createElement('input');
      input.className = 'field__input';
      input.type = 'number';
      input.min = '0';
      input.step = '1';
      input.value = value;
      input.dataset['tier'] = role;

      wrapper.append(caption, input);
      return wrapper;
    };

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'button button--danger';
    setText(remove, 'Retirer');
    remove.addEventListener('click', () => {
      row.remove();
    });

    row.append(makeField('Seuil, en bits', minBits, 'min'), makeField('Secondes', seconds, 'seconds'), remove);
    tiersList.append(row);
  }

  /** Lit l'éditeur de paliers, ligne par ligne. */
  function readTierRows(): TierInput[] {
    return [...tiersList.querySelectorAll('.tier')].map((row) => ({
      minBits: row.querySelector<HTMLInputElement>('[data-tier="min"]')?.value ?? '',
      seconds: row.querySelector<HTMLInputElement>('[data-tier="seconds"]')?.value ?? '',
    }));
  }

  function renderTiers(tiers: readonly { minBits: number; seconds: number }[]): void {
    clearChildren(tiersList);
    for (const tier of tiers) {
      appendTierRow(String(tier.minBits), String(tier.seconds));
    }
  }

  requireElement(document, '#add-tier').addEventListener('click', () => {
    appendTierRow('', '');
  });

  /** Repeint tous les champs de réglage depuis la configuration en mémoire. */
  function paintFields(): void {
    for (const view of FIELD_VIEWS) {
      const fields = fieldsOf(view);
      writeFieldValues(containerOf(view), fields, valuesFrom(fields, config));
      clearFieldErrors(containerOf(view), fields);
    }

    const tiers = (config as { rewards?: { bits?: { tiers?: { minBits: number; seconds: number }[] } } })
      .rewards?.bits?.tiers;
    renderTiers(tiers ?? []);
  }

  async function refreshConfig(): Promise<void> {
    const payload = await api.get<{ config: unknown }>('/api/config');
    config = payload.config;
    paintFields();
  }

  /**
   * Enregistre une vue de réglage.
   *
   * Seuls les champs **modifiés** partent : renvoyer les soixante-dix
   * écraserait une valeur changée entre-temps par l'assistant resté ouvert
   * dans une fenêtre voisine.
   */
  async function saveView(view: FieldViewId, extra?: Record<string, unknown>): Promise<void> {
    const fields = fieldsOf(view);
    const container = containerOf(view);

    clearFieldErrors(container, fields);
    const { patch, errors } = patchFrom(fields, readFieldValues(container, fields), config);

    const allErrors: FieldError[] = [...errors];
    const tierMessages: string[] = [];

    if (view === 'rewards') {
      const rows = readTierRows();
      const filled = rows.filter((row) => row.minBits.trim() !== '' || row.seconds.trim() !== '');
      const modeField = container.querySelector<HTMLSelectElement>('#reward-bits-mode');

      // Les paliers ne sont exigés qu'en mode « tiers ». En mode linéaire on
      // les enregistre tout de même s'ils sont renseignés : c'est ainsi qu'on
      // les prépare avant de basculer.
      if (modeField?.value === 'tiers' || filled.length > 0) {
        const { tiers, errors: tierErrors } = normalizeTiers(rows);
        if (tierErrors.length > 0) {
          tierMessages.push(...tierErrors);
        } else if (JSON.stringify(tiers) !== JSON.stringify(readTiersFromConfig())) {
          patch['rewards'] = { ...(patch['rewards'] as object | undefined), bits: {
            ...((patch['rewards'] as { bits?: object } | undefined)?.bits ?? {}),
            tiers,
          } };
        }
      }
    }

    if (allErrors.length > 0 || tierMessages.length > 0) {
      showFieldErrors(container, allErrors);
      const first = allErrors[0]?.message ?? tierMessages[0] ?? '';
      showBanner(`Rien n’a été enregistré. ${first}`, 'banner--error');
      return;
    }

    if (Object.keys(patch).length === 0 && extra === undefined) {
      showBanner('Aucune modification à enregistrer.', 'banner--success');
      return;
    }

    // Le secret client est **frère** de `config` dans le corps, jamais son
    // enfant : il va dans le magasin chiffré et ne ressort par aucune lecture.
    await api.patch('/api/config', { ...(Object.keys(patch).length > 0 ? { config: patch } : {}), ...extra });
    await refreshConfig();
    showBanner('Modifications enregistrées.', 'banner--success');
  }

  function readTiersFromConfig(): unknown {
    return (
      (config as { rewards?: { bits?: { tiers?: unknown } } }).rewards?.bits?.tiers ?? []
    );
  }

  for (const view of ['rewards', 'appearance', 'settings'] as const) {
    const control = button(`#save-${view}`);
    control.addEventListener('click', () => {
      void guarded(control, () => saveView(view));
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Vue Twitch                                                             */
  /* ---------------------------------------------------------------------- */

  async function refreshTwitch(): Promise<void> {
    const status = await api.get<TwitchDescription>('/api/twitch/status');

    setText(requireElement(document, '#twitch-login'), status.broadcasterLogin || '—');

    const connection = requireElement(document, '#twitch-connection');
    setText(connection, status.connected ? 'Connecté' : 'Non connecté');
    connection.className = status.connected ? 'pill pill--ok' : 'pill pill--warning';

    const secret = requireElement(document, '#twitch-secret');
    setText(secret, status.hasClientSecret ? 'Secret enregistré' : 'Aucun secret');
    secret.className = status.hasClientSecret ? 'pill pill--ok' : 'pill pill--warning';

    setText(
      requireElement(document, '#twitch-scopes'),
      status.missingScopes.length === 0
        ? 'Toutes les autorisations nécessaires ont été accordées.'
        : 'Autorisations manquantes : le compteur fonctionne, mais ces sources ne créditeront rien.',
      200,
    );

    const missing = requireElement(document, '#twitch-missing-scopes');
    clearChildren(missing);
    for (const scope of status.missingScopes) {
      const item = document.createElement('li');
      setText(item, scope);
      missing.append(item);
    }
  }

  async function refreshSubscriptions(): Promise<void> {
    const { subscriptions } = await api.get<{
      subscriptions: readonly { id: string; type: string; status: string }[];
    }>('/api/twitch/subscriptions');

    const list = requireElement(document, '#twitch-subscriptions');
    clearChildren(list);
    requireElement(document, '#twitch-subscriptions-empty').hidden = subscriptions.length > 0;

    for (const subscription of subscriptions) {
      const item = document.createElement('li');
      setText(item, `${subscription.type} — ${subscription.status}`, 120);
      list.append(item);
    }
  }

  const saveTwitch = button('#save-twitch');
  saveTwitch.addEventListener('click', () => {
    void guarded(saveTwitch, async () => {
      const secretField = input('#twitch-client-secret');
      const secret = secretField.value;

      await saveView('twitch', secret === '' ? undefined : { clientSecret: secret });
      secretField.value = '';
      await refreshTwitch();
    });
  });

  const reconnect = button('#twitch-reconnect');
  reconnect.addEventListener('click', () => {
    void guarded(reconnect, async () => {
      const result = await api.post<{ authorizationUrl: string }>('/api/twitch/connect');
      if (result !== null) {
        window.location.assign(result.authorizationUrl);
      }
    });
  });

  const revoke = button('#twitch-revoke');
  revoke.addEventListener('click', () => {
    void guarded(revoke, async () => {
      await api.post('/api/twitch/revoke');
      await refreshTwitch();
      await refreshSubscriptions();
      showBanner('Accès révoqué.', 'banner--success');
    });
  });

  const refreshSubs = button('#twitch-refresh');
  refreshSubs.addEventListener('click', () => {
    void guarded(refreshSubs, refreshSubscriptions);
  });

  /* ---------------------------------------------------------------------- */
  /* Import et export                                                       */
  /* ---------------------------------------------------------------------- */

  const importButton = button('#import-config');
  importButton.addEventListener('click', () => {
    void guarded(importButton, async () => {
      const file = input('#import-file').files?.[0];
      if (file === undefined) {
        showBanner('Choisissez d’abord un fichier.', 'banner--error');
        return;
      }

      await api.post('/api/config/import', { content: await file.text() });
      await refreshConfig();
      showBanner('Configuration importée.', 'banner--success');
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Démarrage                                                              */
  /* ---------------------------------------------------------------------- */

  for (const view of FIELD_VIEWS) {
    renderFieldGroups(document, containerOf(view), fieldsOf(view), groupsOf(view));
  }

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

  // La configuration n'est pas dans l'instantané du WebSocket, qui ne diffuse
  // que la section `overlay` : elle se lit par l'API.
  void refreshConfig().then(
    () => {
      const initial = (config as { counter?: { initialSeconds?: number } }).counter?.initialSeconds;
      if (initial !== undefined) {
        input('#initial-hours').value = String(initial / 3_600);
      }
    },
    (error: unknown) => {
      reportFailure(error);
    },
  );

  // Twitch en dernier et sans bloquer : c'est justement quand Twitch ne répond
  // pas que le streamer doit pouvoir ouvrir son panneau.
  void refreshTwitch().catch((error: unknown) => {
    reportFailure(error);
  });
  void refreshSubscriptions().catch(() => {
    // Sans jeton, cette route répond 502 : l'annoncer sur chaque ouverture du
    // panneau d'une installation neuve n'apprendrait rien à personne.
  });

  client.start();
  window.requestAnimationFrame(render);
}

start();
