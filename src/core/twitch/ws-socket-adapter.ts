/**
 * Fabrique de sockets EventSub adossée à `ws`.
 *
 * Le client EventSub ne connaît qu'une interface : c'est ce qui permet de le
 * tester intégralement sans réseau, en injectant des messages à la main. Ce
 * fichier est le seul endroit où cette interface rencontre une vraie connexion,
 * et il est partagé par le point d'entrée headless et par la future coquille
 * Electron — deux implémentations finiraient par diverger.
 *
 * Une précaution y compte plus que le reste : **un écouteur d'erreur est posé
 * systématiquement**. Sans lui, une trame malformée émise par le serveur devient
 * une exception non traitée qui abat le processus Node, et donc le subathon.
 */

import WebSocket from 'ws';

import type { EventSubSocket, EventSubSocketFactory } from './eventsub-client.js';

/** Enveloppe une connexion `ws` dans l'interface attendue par le client EventSub. */
export function createWebSocketFactory(): EventSubSocketFactory {
  return (url: string): EventSubSocket => {
    const socket = new WebSocket(url);

    // Posé avant tout autre : entre la construction et l'abonnement du client,
    // une erreur de connexion peut déjà survenir, et un `error` sans écouteur
    // est fatal au processus.
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
        // `terminate` lorsque la connexion n'est pas établie : `close` y lève,
        // et une reconnexion ne doit pas échouer à cause de la précédente.
        if (socket.readyState === WebSocket.OPEN) {
          socket.close();
          return;
        }
        socket.terminate();
      },
    };
  };
}
