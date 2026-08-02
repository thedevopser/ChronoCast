import { describe, expect, it, vi } from 'vitest';

import { createLoopbackPair, type ArmableServer } from '../../../src/core/server/loopback-pair.js';

/**
 * Paire de serveurs de bouclage, IPv4 et IPv6.
 *
 * Elle n'existe que pour une raison, et cette raison est imposée de
 * l'extérieur : Twitch n'accepte une redirection en HTTP que vers le **nom**
 * `localhost`, jamais vers `127.0.0.1`. Or un nom se résout — et sous Windows
 * `localhost` mène souvent à `::1` avant `127.0.0.1`.
 *
 * Un serveur qui n'écouterait que sur l'adresse IPv4 laisserait donc le
 * navigateur frapper une adresse morte **après** que l'utilisateur a donné son
 * autorisation à Twitch : le pire moment pour échouer, puisque tout ce qui
 * pouvait mal se passer est déjà derrière et que rien n'explique l'échec.
 *
 * L'inverse est vrai aussi : une machine où IPv6 est désactivé doit continuer
 * de fonctionner. **Il suffit qu'une des deux adresses écoute.**
 */

/**
 * Double de serveur, dont les espions sont exposés **à côté** du contrat.
 *
 * Les lire directement sur l'objet reviendrait à détacher une méthode de son
 * receveur, ce qu'ESLint refuse à juste titre — et désactiver la règle dans un
 * test reviendrait à s'autoriser ce qu'on interdit ailleurs.
 */
function fakeServer(behaviour: { port?: number; fail?: Error }): {
  readonly server: ArmableServer;
  readonly started: ReturnType<typeof vi.fn>;
  readonly stopped: ReturnType<typeof vi.fn>;
} {
  const started = vi.fn(() =>
    behaviour.fail ? Promise.reject(behaviour.fail) : Promise.resolve(behaviour.port ?? 37_771),
  );
  const stopped = vi.fn(() => Promise.resolve());

  return { server: { start: started, stop: stopped }, started, stopped };
}

describe('createLoopbackPair', () => {
  it('écoute sur les deux adresses de bouclage', async () => {
    const v4 = fakeServer({ port: 37_771 });
    const v6 = fakeServer({ port: 37_771 });

    const pair = createLoopbackPair({ createFor: (host) => (host === '127.0.0.1' ? v4.server : v6.server) });
    await pair.start();

    expect(v4.started).toHaveBeenCalled();
    expect(v6.started).toHaveBeenCalled();
  });

  it('demande bien 127.0.0.1 puis ::1, et rien d’autre', async () => {
    // Le bouclage strict est une exigence du modèle de menace : élargir cette
    // liste exposerait le rappel OAuth au réseau local.
    const hosts: string[] = [];

    const pair = createLoopbackPair({
      createFor: (host) => {
        hosts.push(host);
        return fakeServer({ port: 37_771 }).server;
      },
    });
    await pair.start();

    expect(hosts).toEqual(['127.0.0.1', '::1']);
  });

  it('tient debout quand IPv6 est indisponible', async () => {
    // Cas réel : IPv6 désactivé sur la machine. `::1` refuse le bind, et le
    // flux OAuth doit continuer de fonctionner en IPv4.
    const pair = createLoopbackPair({
      createFor: (host) =>
        host === '::1'
          ? fakeServer({ fail: new Error('EAFNOSUPPORT') }).server
          : fakeServer({ port: 37_771 }).server,
    });

    await expect(pair.start()).resolves.toBe(37_771);
  });

  it('tient debout quand IPv4 est indisponible', async () => {
    const pair = createLoopbackPair({
      createFor: (host) =>
        host === '127.0.0.1'
          ? fakeServer({ fail: new Error('EADDRNOTAVAIL') }).server
          : fakeServer({ port: 37_771 }).server,
    });

    await expect(pair.start()).resolves.toBe(37_771);
  });

  it('échoue franchement si aucune adresse n’écoute', async () => {
    // Le port est occupé, ou les droits manquent. Mieux vaut une erreur au clic
    // qu'un flux qui part vers Twitch pour revenir sur un serveur inexistant.
    const pair = createLoopbackPair({
      createFor: () => fakeServer({ fail: new Error('EADDRINUSE') }).server,
    });

    await expect(pair.start()).rejects.toThrow(/EADDRINUSE/);
  });

  it('arrête les deux serveurs, même celui qui n’a pas démarré', async () => {
    // `stop()` doit rester sûr quel que soit l'état : un serveur qui n'a pas
    // pris son port ne doit pas empêcher d'arrêter l'autre.
    const v4 = fakeServer({ port: 37_771 });
    const v6 = fakeServer({ fail: new Error('EAFNOSUPPORT') });

    const pair = createLoopbackPair({ createFor: (host) => (host === '127.0.0.1' ? v4.server : v6.server) });
    await pair.start();
    await pair.stop();

    expect(v4.stopped).toHaveBeenCalled();
    expect(v6.stopped).toHaveBeenCalled();
  });

  it('n’échoue pas lorsqu’un arrêt échoue', async () => {
    // L'arrêt survient pendant l'extinction du flux OAuth : y lever masquerait
    // la raison réelle de cette extinction.
    const v4: ArmableServer = {
      start: () => Promise.resolve(37_771),
      stop: () => Promise.reject(new Error('déjà fermé')),
    };
    const pair = createLoopbackPair({
      createFor: (host) => (host === '127.0.0.1' ? v4 : fakeServer({ port: 37_771 }).server),
    });
    await pair.start();

    await expect(pair.stop()).resolves.toBeUndefined();
  });
});
