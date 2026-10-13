import { beforeEach, describe, expect, it } from 'vitest';

import { createLogger, type LogSink } from '../../../src/core/logging/logger.js';
import type { AtomicJsonStore } from '../../../src/core/storage/atomic-json-store.js';
import {
  createUpdateNotice,
  parseUpdateNotice,
  type UpdateNoticeState,
} from '../../../src/core/update/update-notice.js';

const SILENT_SINK: LogSink = { name: 'silencieux', write: () => undefined };

describe('annonce de mise à jour', () => {
  let persisted: UpdateNoticeState | null;
  let store: AtomicJsonStore<UpdateNoticeState | null>;

  const build = () =>
    createUpdateNotice({ store, logger: createLogger({ level: 'error', sinks: [SILENT_SINK] }) });

  beforeEach(() => {
    persisted = null;
    store = {
      filePath: '/mémoire/update-notice.json',
      read: () => Promise.resolve(persisted),
      write: (value) => {
        persisted = value;
        return Promise.resolve();
      },
    };
  });

  it('n’annonce rien sur une installation neuve', async () => {
    const notice = build();
    await notice.start();

    expect(notice.get()).toBeNull();
  });

  it('retient et persiste la remise à zéro de la barre, avec le compte qu’elle avait', async () => {
    const notice = build();
    await notice.start();

    await notice.announceGoalsReset(37);

    expect(notice.get()).toStrictEqual({ goalsReset: { previousCount: 37 } });
    expect(persisted).toStrictEqual({ goalsReset: { previousCount: 37 } });
  });

  it('reste en attente d’une ouverture à l’autre tant qu’elle n’est pas acquittée', async () => {
    persisted = { goalsReset: { previousCount: 12 } };
    const notice = build();
    await notice.start();

    expect(notice.get()).toStrictEqual({ goalsReset: { previousCount: 12 } });
  });

  it('disparaît pour de bon une fois acquittée', async () => {
    persisted = { goalsReset: { previousCount: 12 } };
    const notice = build();
    await notice.start();

    await notice.acknowledge();

    expect(notice.get()).toBeNull();
    expect(persisted).toBeNull();
  });

  it('accepte un acquittement sans annonce en attente', async () => {
    const notice = build();
    await notice.start();

    await expect(notice.acknowledge()).resolves.toBeUndefined();
  });
});

describe('parseUpdateNotice', () => {
  it('relit un état bien formé', () => {
    expect(parseUpdateNotice({ goalsReset: { previousCount: 3 } })).toStrictEqual({
      goalsReset: { previousCount: 3 },
    });
  });

  it.each([null, undefined, 'texte', {}, { goalsReset: {} }, { goalsReset: { previousCount: -1 } }, { goalsReset: { previousCount: '3' } }])(
    'tient un fichier de forme %o pour une absence d’annonce',
    (raw) => {
      expect(parseUpdateNotice(raw)).toBeNull();
    },
  );
});
