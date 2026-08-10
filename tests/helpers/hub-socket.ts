import type { HubSocket } from '../../src/core/server/ws-hub.js';

export interface SocketDouble {
  readonly socket: HubSocket;
  readonly sent: Record<string, unknown>[];
  readonly pings: number;
  readonly closed: boolean;
  readonly closeCode: number | null;
  receive(data: string): void;
  pong(): void;
  disconnect(): void;
  breakSending(): void;
}

export function createSocketDouble(): SocketDouble {
  const sent: Record<string, unknown>[] = [];
  const handlers: {
    message?: (data: string) => void;
    close?: () => void;
    pong?: () => void;
  } = {};

  let pings = 0;
  let closed = false;
  let closeCode: number | null = null;
  let broken = false;

  const socket: HubSocket = {
    send(data: string): void {
      if (broken) {
        throw new Error('socket fermée');
      }
      sent.push(JSON.parse(data) as Record<string, unknown>);
    },
    close(code?: number): void {
      closed = true;
      closeCode = code ?? null;
      handlers.close?.();
    },
    ping(): void {
      if (broken) {
        throw new Error('socket fermée');
      }
      pings += 1;
    },
    onMessage(handler): void {
      handlers.message = handler;
    },
    onClose(handler): void {
      handlers.close = handler;
    },
    onPong(handler): void {
      handlers.pong = handler;
    },
  };

  return {
    socket,
    sent,
    get pings(): number {
      return pings;
    },
    get closed(): boolean {
      return closed;
    },
    get closeCode(): number | null {
      return closeCode;
    },
    receive(data: string): void {
      handlers.message?.(data);
    },
    pong(): void {
      handlers.pong?.();
    },
    disconnect(): void {
      closed = true;
      handlers.close?.();
    },
    breakSending(): void {
      broken = true;
    },
  };
}
