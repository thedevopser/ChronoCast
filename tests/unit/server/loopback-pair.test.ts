import { describe, expect, it, vi } from 'vitest';

import { createLoopbackPair, type ArmableServer } from '../../../src/core/server/loopback-pair.js';

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
    const pair = createLoopbackPair({
      createFor: () => fakeServer({ fail: new Error('EADDRINUSE') }).server,
    });

    await expect(pair.start()).rejects.toThrow(/EADDRINUSE/);
  });

  it('arrête les deux serveurs, même celui qui n’a pas démarré', async () => {
    const v4 = fakeServer({ port: 37_771 });
    const v6 = fakeServer({ fail: new Error('EAFNOSUPPORT') });

    const pair = createLoopbackPair({ createFor: (host) => (host === '127.0.0.1' ? v4.server : v6.server) });
    await pair.start();
    await pair.stop();

    expect(v4.stopped).toHaveBeenCalled();
    expect(v6.stopped).toHaveBeenCalled();
  });

  it('n’échoue pas lorsqu’un arrêt échoue', async () => {
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
