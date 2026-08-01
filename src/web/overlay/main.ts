/**
 * Point d'entrée de l'overlay.
 *
 * Ce fichier n'est **que du câblage** : il ne décide rien. Le décompte, la
 * reconnexion, la mise en forme, la file des bulles et la traduction de la
 * configuration en variables CSS vivent dans des modules purs, tous couverts
 * par des tests. Ce qui reste ici — obtenir les éléments du gabarit, brancher
 * un vrai `WebSocket`, appeler `requestAnimationFrame` — n'est pas vérifiable
 * sans navigateur et n'a rien à décider.
 *
 * Aucune écriture directe dans le DOM : tout passe par `safe-dom`. Aucun
 * `console` non plus, banni par ESLint dans `src/web` — un overlay n'a pas de
 * lecteur, et un incident se diagnostique par les journaux du serveur.
 */

import { createCountdown, type SyncMode } from '../shared/countdown.js';
import {
  requireElement,
  setCssVariables,
  setText,
  MAX_TEXT_LENGTH,
} from '../shared/safe-dom.js';
import { formatRemaining, formatReward } from '../shared/time-format.js';
import {
  PROTOCOL_VERSION,
  type Channel,
  type CounterChangeOrigin,
  type OverlayConfig,
  type ServerMessage,
} from '../shared/protocol.js';
import { createWsClient, type WsSocket } from '../shared/ws-client.js';
import { overlayCssVariables } from './overlay-style.js';
import { createToastQueue } from './toast-queue.js';

/**
 * Canaux utiles à l'overlay.
 *
 * Ni `log` ni `twitch` : pousser chaque ligne de journal vers une Browser
 * Source qui n'en fait rien gaspille de la bande passante et du travail de
 * désérialisation, soixante fois par seconde de direct.
 */
const OVERLAY_CHANNELS: readonly Channel[] = ['counter', 'event', 'config'];

/** Classes d'animation, alignées sur `overlay.animation.onAdd` du schéma. */
const ANIMATION_CLASSES: Readonly<Record<string, string>> = {
  flash: 'is-flash',
  pulse: 'is-pulse',
  shake: 'is-shake',
};

/**
 * Adaptateur du `WebSocket` du navigateur vers le port attendu par le client.
 *
 * Il déplie `MessageEvent.data` pour que `ws-client` n'ait pas à connaître le
 * DOM — c'est ce qui permet de le tester dans un Node nu.
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
  const root = document.documentElement;
  const countdownElement = requireElement(document, '#countdown');
  const toastElement = requireElement(document, '#toast');
  const toastUserElement = requireElement(document, '#toast-user');
  const toastRewardElement = requireElement(document, '#toast-reward');

  const countdown = createCountdown();
  const toasts = createToastQueue();

  let overlayConfig: OverlayConfig | null = null;
  let animationTimer: number | null = null;

  // Dernières valeurs écrites : réécrire un `textContent` identique à chaque
  // image provoque un recalcul de mise en page inutile, soixante fois par
  // seconde et pendant des heures.
  let renderedCountdown = '';
  let renderedToastId: string | null = null;

  function applyConfig(config: OverlayConfig): void {
    overlayConfig = config;
    setCssVariables(root, overlayCssVariables(config));
  }

  function playAddAnimation(): void {
    const effect = overlayConfig?.animation.onAdd ?? 'none';
    const className = ANIMATION_CLASSES[effect];
    if (className === undefined) {
      return;
    }

    // Retrait puis reflow forcé : sans cela, deux ajouts rapprochés ne
    // rejoueraient pas l'animation, le navigateur ne voyant aucun changement
    // de classe.
    countdownElement.classList.remove(className);
    void countdownElement.offsetWidth;
    countdownElement.classList.add(className);

    if (animationTimer !== null) {
      window.clearTimeout(animationTimer);
    }
    animationTimer = window.setTimeout(() => {
      countdownElement.classList.remove(className);
      animationTimer = null;
    }, overlayConfig?.animation.durationMs ?? 600);
  }

  /** Une érosion de routine se rattrape ; tout le reste s'impose. */
  function syncModeOf(origin: CounterChangeOrigin): SyncMode {
    return origin === 'tick' ? 'tick' : 'authoritative';
  }

  function handle(message: ServerMessage): void {
    switch (message.type) {
      case 'hello':
        // Une Browser Source n'est jamais rechargée : une page ancienne peut
        // parler à un serveur neuf. On le note pour le diagnostic, sans rien
        // afficher — un avertissement à l'écran partirait sur le direct.
        if (message.protocolVersion !== PROTOCOL_VERSION) {
          root.dataset['protocolMismatch'] = String(message.protocolVersion);
        }
        applyConfig(message.overlay);
        break;

      case 'state':
        countdown.sync(message.counter, performance.now(), 'authoritative');
        break;

      case 'counter':
        countdown.sync(message.state, performance.now(), syncModeOf(message.origin));
        if (message.deltaMs > 0) {
          playAddAnimation();
        }
        break;

      case 'event':
        // Un événement non crédité — plafond atteint, barème à zéro — n'a rien
        // à annoncer : la bulle promettrait un gain qui n'a pas eu lieu.
        if (message.applied && (overlayConfig?.toast.enabled ?? false)) {
          toasts.push(
            {
              id: message.event.id,
              userName: message.event.userName,
              rewardSeconds: message.rewardSeconds,
              type: message.event.type,
            },
            performance.now(),
            overlayConfig?.toast.durationMs ?? 4_000,
          );
        }
        break;

      case 'config':
        applyConfig(message.overlay);
        break;

      case 'twitch:status':
      case 'log':
      case 'pong':
      case 'error':
        // Rien à afficher : l'overlay ne montre que le compteur et ses bulles.
        break;
    }
  }

  function render(): void {
    const now = performance.now();

    const text = formatRemaining(countdown.remainingAt(now), {
      showDays: overlayConfig?.showDays ?? true,
      hideEmptyHours: overlayConfig?.hideEmptyHours ?? false,
    });
    if (text !== renderedCountdown) {
      setText(countdownElement, text, MAX_TEXT_LENGTH);
      renderedCountdown = text;
    }

    const toast = toasts.current(now);
    if (toast === null) {
      if (renderedToastId !== null) {
        toastElement.hidden = true;
        renderedToastId = null;
      }
    } else if (toast.id !== renderedToastId) {
      setText(toastUserElement, toast.userName);
      setText(toastRewardElement, formatReward(toast.rewardSeconds));
      toastElement.hidden = false;
      renderedToastId = toast.id;
    }

    window.requestAnimationFrame(render);
  }

  const client = createWsClient({
    // Le WebSocket est attaché au serveur HTTP par défaut : même hôte, même
    // port. Le mode `separate` n'est pas découvrable depuis la page.
    url: `ws://${window.location.host}/ws`,
    channels: OVERLAY_CHANNELS,
    createSocket: createBrowserSocket,
    onMessage: handle,
    timers: {
      setTimeout: (run, delay) => window.setTimeout(run, delay),
      clearTimeout: (id) => {
        window.clearTimeout(id);
      },
    },
  });

  client.start();
  window.requestAnimationFrame(render);
}

start();
