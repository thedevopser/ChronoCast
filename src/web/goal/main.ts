import { requireElement, setCssVariables, setText } from '../shared/safe-dom.js';
import {
  PROTOCOL_VERSION,
  type Channel,
  type GoalMessage,
  type GoalOverlayConfig,
  type ServerMessage,
} from '../shared/protocol.js';
import { createToastQueue } from '../shared/toast-queue.js';
import { createWsClient, type WsSocket } from '../shared/ws-client.js';
import { readWebSocketPort, resolveWebSocketUrl } from '../shared/ws-url.js';
import { goalCssVariables } from './goal-style.js';
import { readGoalPreviewMessage } from './preview.js';
import { announcementsOf, goalDisplay, type GoalAnnouncement } from './goal-view.js';

// Ni `counter` ni `event` : la page n'affiche pas le chrono, et une page qui ne reçoit que ce
// qu'elle montre se laisse ouverte des jours dans OBS.
const GOAL_CHANNELS: readonly Channel[] = ['goal', 'config'];

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

  const goalElement = requireElement(document, '#goal');
  const barFillElement = requireElement(document, '#bar-fill');
  const labelElement = requireElement(document, '#goal-label');
  const countElement = requireElement(document, '#goal-count');

  const announceElement = requireElement(document, '#announce');
  const announceTextElement = requireElement(document, '#announce-text');
  const announceLabelElement = requireElement(document, '#announce-label');

  const announcements = createToastQueue<GoalAnnouncement>();

  let overlayConfig: GoalOverlayConfig | null = null;
  let goal: GoalMessage | null = null;

  let renderedGoal = '';
  let renderedAnnouncementId: string | null = null;

  function applyConfig(config: GoalOverlayConfig): void {
    overlayConfig = config;
    setCssVariables(root, goalCssVariables(config));
  }

  /**
   * Le panneau prévisualise ses réglages en poussant un brouillon dans l'iframe qu'il embarque.
   *
   * L'écouteur n'est posé que sur une page encadrée : une Browser Source OBS n'a pas de parent, et
   * n'expose donc rien. L'annonce d'essai, elle, ne passe pas par ici — elle arrive par le canal
   * WebSocket, si bien qu'elle joue dans l'aperçu et dans OBS du même geste.
   */
  function listenToPreview(): void {
    if (window.parent === window) {
      return;
    }

    window.addEventListener('message', (event: MessageEvent<unknown>) => {
      const draft = readGoalPreviewMessage(
        { origin: event.origin, data: event.data },
        window.location.origin,
      );

      if (draft !== null) {
        applyConfig(draft);
      }
    });
  }

  function handle(message: ServerMessage): void {
    switch (message.type) {
      case 'hello':
        if (message.protocolVersion !== PROTOCOL_VERSION) {
          root.dataset['protocolMismatch'] = String(message.protocolVersion);
        }
        applyConfig(message.goalOverlay);
        break;

      case 'config':
        applyConfig(message.goalOverlay);
        break;

      case 'goal': {
        goal = message;

        if (overlayConfig !== null) {
          const now = performance.now();
          for (const announcement of announcementsOf(message, overlayConfig)) {
            announcements.push(announcement, now, overlayConfig.announce.durationMs);
          }
        }
        break;
      }

      case 'state':
      case 'counter':
      case 'event':
      case 'twitch:status':
      case 'log':
      case 'pong':
      case 'error':
        break;
    }
  }

  function paintAnnouncement(announcement: GoalAnnouncement): void {
    if (announcement.id === renderedAnnouncementId) {
      return;
    }

    setText(announceTextElement, announcement.text);
    announceTextElement.hidden = announcement.text === '';

    setText(announceLabelElement, announcement.label);

    announceElement.hidden = false;
    goalElement.hidden = true;
    renderedAnnouncementId = announcement.id;
  }

  function paintGoal(): void {
    if (renderedAnnouncementId !== null) {
      announceElement.hidden = true;
      renderedAnnouncementId = null;
    }

    if (goal === null || overlayConfig === null) {
      return;
    }

    const view = goalDisplay(goal, overlayConfig);
    goalElement.hidden = !view.visible;

    const painted = `${view.label}|${view.count}|${String(view.progress)}`;
    if (painted === renderedGoal) {
      return;
    }

    setText(labelElement, view.label);
    setText(countElement, view.count);
    setCssVariables(barFillElement, { '--cc-goal-progress': String(view.progress) });
    renderedGoal = painted;
  }

  function render(): void {
    const announcement = announcements.current(performance.now());

    if (announcement === null) {
      paintGoal();
    } else {
      paintAnnouncement(announcement);
    }

    window.requestAnimationFrame(render);
  }

  const client = createWsClient({
    url: resolveWebSocketUrl({
      host: window.location.host,
      protocol: window.location.protocol,
      port: readWebSocketPort(document),
    }),
    channels: GOAL_CHANNELS,
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
  listenToPreview();
  window.requestAnimationFrame(render);
}

start();
