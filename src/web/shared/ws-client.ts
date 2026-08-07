import { parseServerMessage, type Channel, type ServerMessage } from './protocol.js';

export interface WsSocket {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((data: unknown) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

export type WsSocketFactory = (url: string) => WsSocket;

export interface TimerPort {
  setTimeout(run: () => void, delayMs: number): number;
  clearTimeout(id: number): void;
}

export type WsClientStatus = 'connecting' | 'open' | 'reconnecting' | 'stopped';

export interface BackoffOptions {
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly factor: number;
  readonly jitterRatio: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = {
  initialDelayMs: 500,
  maxDelayMs: 30_000,
  factor: 2,
  jitterRatio: 0.2,
};

export function backoffDelay(
  attempt: number,
  options: BackoffOptions,
  random: () => number,
): number {
  const base = Math.min(options.initialDelayMs * options.factor ** (attempt - 1), options.maxDelayMs);

  const jitter = base * options.jitterRatio * (random() * 2 - 1);

  return Math.max(0, Math.round(base + jitter));
}

export interface WsClientOptions {
  readonly url: string;
  readonly channels: readonly Channel[];
  readonly createSocket: WsSocketFactory;
  readonly onMessage: (message: ServerMessage) => void;
  readonly onStatusChange?: (status: WsClientStatus) => void;
  readonly timers: TimerPort;
  readonly random?: () => number;
  readonly backoff?: BackoffOptions;
}

export interface WsClient {
  start(): void;
  stop(): void;
  getStatus(): WsClientStatus;
}

export function createWsClient(options: WsClientOptions): WsClient {
  const backoff = options.backoff ?? DEFAULT_BACKOFF;
  const random = options.random ?? Math.random;

  let socket: WsSocket | null = null;
  let retryTimer: number | null = null;
  let attempt = 0;
  let stopped = false;
  let status: WsClientStatus = 'connecting';
  let announced = false;

  function setStatus(next: WsClientStatus): void {
    if (announced && next === status) {
      return;
    }
    status = next;
    announced = true;
    options.onStatusChange?.(next);
  }

  function connect(): void {
    setStatus('connecting');

    const opened = options.createSocket(options.url);
    socket = opened;

    opened.onopen = (): void => {
      attempt = 0;
      setStatus('open');
      opened.send(JSON.stringify({ type: 'subscribe', channels: [...options.channels] }));
    };

    opened.onmessage = (data: unknown): void => {
      const message = parseServerMessage(data);
      if (message !== null) {
        options.onMessage(message);
      }
    };

    opened.onclose = handleDisconnect;
    opened.onerror = handleDisconnect;
  }

  function handleDisconnect(): void {
    if (stopped) {
      return;
    }

    if (retryTimer !== null) {
      return;
    }

    socket = null;
    attempt += 1;
    setStatus('reconnecting');

    retryTimer = options.timers.setTimeout(() => {
      retryTimer = null;
      connect();
    }, backoffDelay(attempt, backoff, random));
  }

  return {
    start(): void {
      stopped = false;
      connect();
    },

    stop(): void {
      stopped = true;

      if (retryTimer !== null) {
        options.timers.clearTimeout(retryTimer);
        retryTimer = null;
      }

      socket?.close();
      socket = null;
      setStatus('stopped');
    },

    getStatus(): WsClientStatus {
      return status;
    },
  };
}
