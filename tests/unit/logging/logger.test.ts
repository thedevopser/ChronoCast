import { describe, expect, it, vi } from 'vitest';

import { createLogger, type LogRecord, type LogSink } from '../../../src/core/logging/logger.js';
import { createRedactor, REDACTED } from '../../../src/core/logging/redaction.js';

/**
 * Le logger est le seul canal de diagnostic dont dispose l'utilisateur final :
 * l'application tourne sans terminal, et le panneau d'administration affiche
 * exactement ce que ces enregistrements contiennent.
 *
 * Deux exigences en découlent, et ce sont elles que ces tests verrouillent :
 * un puits défaillant ne doit jamais interrompre l'appelant, et aucun secret ne
 * doit franchir cette frontière.
 */

/** Puits de test conservant les enregistrements en mémoire. */
function createMemorySink(name = 'memory'): LogSink & { readonly records: LogRecord[] } {
  const records: LogRecord[] = [];
  return {
    name,
    records,
    write(record: LogRecord): void {
      records.push(record);
    },
  };
}

/** Horloge figée : les horodatages doivent être déterministes en test. */
function fixedClock(iso: string): () => Date {
  const instant = new Date(iso);
  return () => instant;
}

describe('createLogger', () => {
  describe('diffusion aux puits', () => {
    it('transmet un enregistrement complet à chaque puits', () => {
      const first = createMemorySink('first');
      const second = createMemorySink('second');
      const logger = createLogger({
        level: 'debug',
        sinks: [first, second],
        scope: 'twitch',
        now: fixedClock('2026-08-01T10:00:00.000Z'),
      });

      logger.info('connexion établie', { sessionId: 'abc' });

      const expected: LogRecord = {
        timestamp: '2026-08-01T10:00:00.000Z',
        level: 'info',
        scope: 'twitch',
        message: 'connexion établie',
        context: { sessionId: 'abc' },
      };
      expect(first.records).toEqual([expected]);
      expect(second.records).toEqual([expected]);
    });

    it('omet le contexte lorsque aucun n\'est fourni', () => {
      const sink = createMemorySink();
      const logger = createLogger({ level: 'debug', sinks: [sink] });

      logger.info('démarrage');

      expect(sink.records[0]).not.toHaveProperty('context');
    });

    it('accepte un puits ajouté après la création', () => {
      const initial = createMemorySink('initial');
      const late = createMemorySink('late');
      const logger = createLogger({ level: 'debug', sinks: [initial] });

      logger.addSink(late);
      logger.info('après ajout');

      expect(late.records).toHaveLength(1);
    });

    it('cesse de transmettre à un puits retiré', () => {
      const sink = createMemorySink('jetable');
      const logger = createLogger({ level: 'debug', sinks: [sink] });

      logger.removeSink('jetable');
      logger.info('après retrait');

      expect(sink.records).toHaveLength(0);
    });
  });

  describe('niveaux', () => {
    it('ignore les enregistrements sous le niveau configuré', () => {
      const sink = createMemorySink();
      const logger = createLogger({ level: 'warning', sinks: [sink] });

      logger.debug('invisible');
      logger.info('invisible');
      logger.warning('visible');
      logger.error('visible');

      expect(sink.records.map((record) => record.level)).toEqual(['warning', 'error']);
    });

    it('applique un changement de niveau à chaud', () => {
      const sink = createMemorySink();
      const logger = createLogger({ level: 'error', sinks: [sink] });

      logger.debug('ignoré');
      logger.setLevel('debug');
      logger.debug('retenu');

      expect(sink.records.map((record) => record.message)).toEqual(['retenu']);
    });

    it('expose le niveau courant', () => {
      const logger = createLogger({ level: 'info', sinks: [] });

      expect(logger.getLevel()).toBe('info');
      logger.setLevel('debug');
      expect(logger.getLevel()).toBe('debug');
    });
  });

  describe('portées imbriquées', () => {
    it('compose la portée du parent et celle de l\'enfant', () => {
      const sink = createMemorySink();
      const logger = createLogger({ level: 'debug', sinks: [sink], scope: 'twitch' });

      logger.child('eventsub').info('abonné');

      expect(sink.records[0]?.scope).toBe('twitch:eventsub');
    });

    it('propage à l\'enfant les changements de niveau du parent', () => {
      const sink = createMemorySink();
      const logger = createLogger({ level: 'error', sinks: [sink] });
      const child = logger.child('compteur');

      child.debug('ignoré');
      logger.setLevel('debug');
      child.debug('retenu');

      expect(sink.records.map((record) => record.message)).toEqual(['retenu']);
    });

    it('propage à l\'enfant les puits ajoutés au parent', () => {
      const late = createMemorySink('late');
      const logger = createLogger({ level: 'debug', sinks: [] });
      const child = logger.child('compteur');

      logger.addSink(late);
      child.info('visible');

      expect(late.records).toHaveLength(1);
    });
  });

  describe('rédaction des secrets', () => {
    it('masque un secret enregistré dans le message et dans le contexte', () => {
      const sink = createMemorySink();
      const redactor = createRedactor();
      redactor.registerSecret('jeton-tres-secret');
      const logger = createLogger({ level: 'debug', sinks: [sink], redactor });

      logger.error('refus pour jeton-tres-secret', {
        access_token: 'jeton-tres-secret',
        endpoint: '/helix/users',
      });

      expect(sink.records[0]?.message).toBe(`refus pour ${REDACTED}`);
      expect(sink.records[0]?.context).toEqual({
        access_token: REDACTED,
        endpoint: '/helix/users',
      });
    });

    it('sérialise une erreur passée en contexte sans perdre son type', () => {
      const sink = createMemorySink();
      const logger = createLogger({ level: 'debug', sinks: [sink], redactor: createRedactor() });

      logger.error('échec de lecture', { cause: new TypeError('fichier illisible') });

      expect(sink.records[0]?.context).toMatchObject({
        cause: { name: 'TypeError', message: 'fichier illisible' },
      });
    });
  });

  describe('robustesse', () => {
    it('poursuit la diffusion lorsqu\'un puits lève une exception', () => {
      const failing: LogSink = {
        name: 'defaillant',
        write(): void {
          throw new Error('disque plein');
        },
      };
      const healthy = createMemorySink('sain');
      const logger = createLogger({ level: 'debug', sinks: [failing, healthy] });

      expect(() => {
        logger.info('doit passer');
      }).not.toThrow();
      expect(healthy.records).toHaveLength(1);
    });

    it('signale la défaillance d\'un puits sans journaliser récursivement', () => {
      const onSinkError = vi.fn();
      const failure = new Error('disque plein');
      const failing: LogSink = {
        name: 'defaillant',
        write(): void {
          throw failure;
        },
      };
      const logger = createLogger({ level: 'debug', sinks: [failing], onSinkError });

      logger.info('déclencheur');

      expect(onSinkError).toHaveBeenCalledTimes(1);
      expect(onSinkError).toHaveBeenCalledWith(failure, 'defaillant');
    });

    it('n\'évalue pas le contexte d\'un enregistrement filtré', () => {
      const buildContext = vi.fn(() => ({ coûteux: true }));
      const logger = createLogger({ level: 'error', sinks: [createMemorySink()] });

      logger.debug('ignoré', buildContext);

      expect(buildContext).not.toHaveBeenCalled();
    });

    it('évalue le contexte différé d\'un enregistrement retenu', () => {
      const sink = createMemorySink();
      const logger = createLogger({ level: 'debug', sinks: [sink] });

      logger.debug('retenu', () => ({ calculé: 1 }));

      expect(sink.records[0]?.context).toEqual({ calculé: 1 });
    });
  });
});
