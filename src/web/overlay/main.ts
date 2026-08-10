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
import { readWebSocketPort, resolveWebSocketUrl } from '../shared/ws-url.js';
import { overlayCssVariables } from './overlay-style.js';
import { createToastQueue } from './toast-queue.js';

const OVERLAY_CHANNELS: readonly Channel[] = ['counter', 'event', 'config'];

const ANIMATION_CLASSES: Readonly<Record<string, string>> = {
  flash: 'is-flash',
  pulse: 'is-pulse',
  shake: 'is-shake',
};

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
  const toastLabelElement = requireElement(document, '#toast-label');
  const toastUserElement = requireElement(document, '#toast-user');
  const toastRewardElement = requireElement(document, '#toast-reward');

  const countdown = createCountdown();
  const toasts = createToastQueue();

  let overlayConfig: OverlayConfig | null = null;
  let animationTimer: number | null = null;

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

  function syncModeOf(origin: CounterChangeOrigin): SyncMode {
    return origin === 'tick' ? 'tick' : 'authoritative';
  }

  function handle(message: ServerMessage): void {
    switch (message.type) {
      case 'hello':
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
        if (message.applied && (overlayConfig?.toast.enabled ?? false)) {
          const toast = {
            id: message.event.id,
            userName: message.event.userName,
            rewardSeconds: message.rewardSeconds,
            type: message.event.type,
          };

          toasts.push(
            message.label === undefined ? toast : { ...toast, label: message.label },
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
      const label = toast.label ?? '';
      setText(toastLabelElement, label);
      toastLabelElement.hidden = label === '';

      setText(toastUserElement, toast.userName);
      setText(toastRewardElement, formatReward(toast.rewardSeconds));
      toastElement.hidden = false;
      renderedToastId = toast.id;
    }

    window.requestAnimationFrame(render);
  }

  const client = createWsClient({
    url: resolveWebSocketUrl({
      host: window.location.host,
      protocol: window.location.protocol,
      port: readWebSocketPort(document),
    }),
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
