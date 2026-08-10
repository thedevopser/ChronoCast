import WebSocket from 'ws';

import type { EventSubSocket, EventSubSocketFactory } from './eventsub-client.js';

export function createWebSocketFactory(): EventSubSocketFactory {
  return (url: string): EventSubSocket => {
    const socket = new WebSocket(url);

    let errorHandler: (error: unknown) => void = () => undefined;
    socket.on('error', (error: unknown) => {
      errorHandler(error);
    });

    return {
      url,

      onOpen(handler: () => void): void {
        socket.on('open', handler);
      },

      onMessage(handler: (data: string) => void): void {
        socket.on('message', (data: Buffer) => {
          handler(data.toString('utf8'));
        });
      },

      onClose(handler: (code: number, reason: string) => void): void {
        socket.on('close', (code: number, reason: Buffer) => {
          handler(code, reason.toString('utf8'));
        });
      },

      onError(handler: (error: unknown) => void): void {
        errorHandler = handler;
      },

      close(): void {
        if (socket.readyState === WebSocket.OPEN) {
          socket.close();
          return;
        }
        socket.terminate();
      },
    };
  };
}
