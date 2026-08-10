import { describe, expect, it, vi } from 'vitest';

import type { LogRecord } from '../../../src/core/logging/logger.js';
import { createConsoleSink } from '../../../src/core/logging/sinks/console-sink.js';
import { createJsonlSink } from '../../../src/core/logging/sinks/jsonl-sink.js';
import { createRingBufferSink } from '../../../src/core/logging/sinks/ring-buffer-sink.js';

function makeRecord(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    timestamp: '2026-08-01T10:00:00.000Z',
    level: 'info',
    scope: 'twitch',
    message: 'connexion établie',
    ...overrides,
  };
}

describe('createRingBufferSink', () => {
  it('restitue les enregistrements du plus ancien au plus récent', () => {
    const sink = createRingBufferSink(10);

    sink.write(makeRecord({ message: 'premier' }));
    sink.write(makeRecord({ message: 'second' }));

    expect(sink.snapshot().map((record) => record.message)).toEqual(['premier', 'second']);
  });

  it('abandonne les plus anciens une fois la capacité atteinte', () => {
    const sink = createRingBufferSink(2);

    sink.write(makeRecord({ message: 'un' }));
    sink.write(makeRecord({ message: 'deux' }));
    sink.write(makeRecord({ message: 'trois' }));

    expect(sink.snapshot().map((record) => record.message)).toEqual(['deux', 'trois']);
  });

  it('renvoie une copie que l\'appelant ne peut pas altérer', () => {
    const sink = createRingBufferSink(5);
    sink.write(makeRecord({ message: 'intact' }));

    sink.snapshot().push(makeRecord({ message: 'intrus' }));

    expect(sink.snapshot()).toHaveLength(1);
  });

  it('se vide sur demande', () => {
    const sink = createRingBufferSink(5);
    sink.write(makeRecord());

    sink.clear();

    expect(sink.snapshot()).toEqual([]);
  });

  it('limite la restitution au nombre demandé', () => {
    const sink = createRingBufferSink(10);
    sink.write(makeRecord({ message: 'un' }));
    sink.write(makeRecord({ message: 'deux' }));
    sink.write(makeRecord({ message: 'trois' }));

    expect(sink.snapshot(2).map((record) => record.message)).toEqual(['deux', 'trois']);
  });

  it('refuse une capacité inexploitable', () => {
    expect(() => createRingBufferSink(0)).toThrow(RangeError);
    expect(() => createRingBufferSink(-1)).toThrow(RangeError);
  });
});

describe('createConsoleSink', () => {
  it('compose une ligne horodatée, avec niveau et portée', () => {
    const lines: string[] = [];
    const sink = createConsoleSink({ writeOut: (line) => lines.push(line) });

    sink.write(makeRecord());

    expect(lines).toEqual(['2026-08-01T10:00:00.000Z INFO    [twitch] connexion établie\n']);
  });

  it('ajoute le contexte sérialisé quand il est présent', () => {
    const lines: string[] = [];
    const sink = createConsoleSink({ writeOut: (line) => lines.push(line) });

    sink.write(makeRecord({ context: { sessionId: 'abc' } }));

    expect(lines[0]).toContain('{"sessionId":"abc"}');
  });

  it('dirige les erreurs vers la sortie d\'erreur', () => {
    const out: string[] = [];
    const err: string[] = [];
    const sink = createConsoleSink({
      writeOut: (line) => out.push(line),
      writeError: (line) => err.push(line),
    });

    sink.write(makeRecord({ level: 'error', message: 'échec' }));

    expect(out).toEqual([]);
    expect(err).toHaveLength(1);
  });

  it('ne lève pas lorsque le contexte n\'est pas sérialisable', () => {
    const lines: string[] = [];
    const sink = createConsoleSink({ writeOut: (line) => lines.push(line) });
    const cyclique: Record<string, unknown> = {};
    cyclique['self'] = cyclique;

    expect(() => {
      sink.write(makeRecord({ context: cyclique }));
    }).not.toThrow();
    expect(lines).toHaveLength(1);
  });
});

describe('createJsonlSink', () => {
  function createStoreDouble() {
    const appended: LogRecord[] = [];
    let rejectWith: Error | undefined;

    return {
      appended,
      failNext(error: Error): void {
        rejectWith = error;
      },
      store: {
        append: (record: LogRecord): Promise<void> => {
          if (rejectWith !== undefined) {
            const failure = rejectWith;
            rejectWith = undefined;
            return Promise.reject(failure);
          }
          appended.push(record);
          return Promise.resolve();
        },
      },
    };
  }

  it('transmet l\'enregistrement au magasin', async () => {
    const double = createStoreDouble();
    const sink = createJsonlSink({ store: double.store });

    sink.write(makeRecord({ message: 'persisté' }));
    await sink.flush();

    expect(double.appended.map((record) => record.message)).toEqual(['persisté']);
  });

  it('rend la main immédiatement sans attendre l\'écriture disque', () => {
    const double = createStoreDouble();
    const sink = createJsonlSink({ store: double.store });

    sink.write(makeRecord());

    expect(double.appended).toHaveLength(0);
  });

  it('signale un échec d\'écriture sans provoquer de rejet non traité', async () => {
    const double = createStoreDouble();
    const onError = vi.fn();
    const sink = createJsonlSink({ store: double.store, onError });
    const failure = new Error('disque plein');
    double.failNext(failure);

    sink.write(makeRecord());
    await sink.flush();

    expect(onError).toHaveBeenCalledWith(failure);
  });

  it('poursuit les écritures suivantes après un échec', async () => {
    const double = createStoreDouble();
    const sink = createJsonlSink({ store: double.store, onError: () => undefined });
    double.failNext(new Error('échec transitoire'));

    sink.write(makeRecord({ message: 'perdu' }));
    sink.write(makeRecord({ message: 'écrit' }));
    await sink.flush();

    expect(double.appended.map((record) => record.message)).toEqual(['écrit']);
  });

  it('préserve l\'ordre des enregistrements', async () => {
    const double = createStoreDouble();
    const sink = createJsonlSink({ store: double.store });

    sink.write(makeRecord({ message: 'un' }));
    sink.write(makeRecord({ message: 'deux' }));
    sink.write(makeRecord({ message: 'trois' }));
    await sink.flush();

    expect(double.appended.map((record) => record.message)).toEqual(['un', 'deux', 'trois']);
  });
});
