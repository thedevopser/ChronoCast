/**
 * Socket d'essai pour le hub WebSocket.
 *
 * Même patron que `createSocketDouble` du client EventSub : le hub ne connaît
 * qu'une interface, les tests injectent la sienne. Aucun serveur, aucun port,
 * aucune attente réelle — et les cas qui comptent, socket muette ou socket qui
 * lève à l'écriture, deviennent triviaux à provoquer.
 */

import type { HubSocket } from '../../src/core/server/ws-hub.js';

export interface SocketDouble {
  readonly socket: HubSocket;
  /** Messages envoyés au client, déjà désérialisés. */
  readonly sent: Record<string, unknown>[];
  readonly pings: number;
  /** Vrai lorsque le hub a fermé la connexion. */
  readonly closed: boolean;
  readonly closeCode: number | null;
  /** Simule un message reçu du client. */
  receive(data: string): void;
  /** Simule la réponse à un ping. */
  pong(): void;
  /** Simule une fermeture à l'initiative du client. */
  disconnect(): void;
  /** Fait échouer toute écriture ultérieure, comme une socket déjà morte. */
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
