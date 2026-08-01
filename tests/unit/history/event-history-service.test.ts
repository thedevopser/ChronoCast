import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createInitialState, type CounterState } from '../../../src/core/counter/counter-state.js';
import type { DomainEvent } from '../../../src/core/events/domain-event.js';
import {
  createEventHistoryService,
  type EventHistoryService,
} from '../../../src/core/history/event-history-service.js';
import { createLogger, type LogSink } from '../../../src/core/logging/logger.js';

/**
 * L'historique répond à une question que le streamer se pose forcément un jour :
 * « d'où viennent ces trois heures ? ». Il doit donc conserver, pour chaque
 * événement, ce qui a été crédité **et pourquoi** — y compris quand rien ne l'a
 * été, car un gift sub ignoré par le plafond est exactement le cas qui intrigue.
 *
 * C'est un journal, jamais une base : on y ajoute, on ne modifie rien. Le format
 * JSONL et la rotation quotidienne rendent la purge triviale et une coupure
 * inoffensive — une ligne tronquée en fin de fichier est simplement ignorée.
 */

const SILENT_SINK: LogSink = { name: 'silencieux', write: () => undefined };

function makeEvent(overrides: Partial<DomainEvent> = {}): DomainEvent {
  return {
    id: 'evt-1',
    type: 'sub',
    tier: 'tier1',
    occurredAt: 1_700_000_000_000,
    userId: '42',
    userName: 'Viewer',
    source: 'eventsub',
    ...overrides,
  } as DomainEvent;
}

describe('createEventHistoryService', () => {
  let directory: string;
  let service: EventHistoryService;
  let state: CounterState;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'chronocast-history-'));
    state = createInitialState({ initialMs: 43_200_000, now: 1_700_000_000_000 });

    service = createEventHistoryService({
      directory,
      logger: createLogger({ level: 'error', sinks: [SILENT_SINK] }),
      retentionDays: 90,
      now: () => new Date('2026-08-01T10:00:00.000Z'),
    });
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('consigne un événement crédité', async () => {
    await service.record(
      makeEvent(),
      { seconds: 180, applied: true, reason: 'sub tier1' },
      state,
    );

    const entries = await service.list(10);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'evt-1',
      type: 'sub',
      userName: 'Viewer',
      rewardSeconds: 180,
      applied: true,
      reason: 'sub tier1',
    });
  });

  it('consigne aussi un événement non crédité', async () => {
    // Un don écarté par le plafond doit apparaître : c'est précisément celui
    // dont le streamer viendra demander l'explication.
    await service.record(
      makeEvent({ id: 'evt-2' }),
      { seconds: 0, applied: false, reason: 'plafond par événement atteint' },
      state,
    );

    expect((await service.list(10))[0]).toMatchObject({ applied: false, rewardSeconds: 0 });
  });

  it("conserve le temps restant d'après l'événement", async () => {
    await service.record(makeEvent(), { seconds: 180, applied: true, reason: 'sub' }, state);

    expect((await service.list(10))[0]?.remainingMsAfter).toBe(state.remainingMs);
  });

  it('rend les entrées de la plus récente à la plus ancienne', async () => {
    for (const id of ['evt-1', 'evt-2', 'evt-3']) {
      await service.record(makeEvent({ id }), { seconds: 60, applied: true, reason: 'sub' }, state);
    }

    expect((await service.list(10)).map((entry) => entry.id)).toEqual([
      'evt-3',
      'evt-2',
      'evt-1',
    ]);
  });

  it('respecte la limite demandée', async () => {
    for (const id of ['evt-1', 'evt-2', 'evt-3']) {
      await service.record(makeEvent({ id }), { seconds: 60, applied: true, reason: 'sub' }, state);
    }

    expect(await service.list(2)).toHaveLength(2);
  });

  it('renvoie une liste vide sur une installation neuve', async () => {
    expect(await service.list(10)).toEqual([]);
  });

  it('conserve les particularités de chaque type', async () => {
    await service.record(
      makeEvent({ id: 'evt-bits', type: 'bits', bits: 500 }),
      { seconds: 360, applied: true, reason: 'bits' },
      state,
    );

    expect((await service.list(1))[0]).toMatchObject({ type: 'bits', detail: 500 });
  });

  it('ignore une ligne corrompue sans perdre les autres', async () => {
    // Une coupure d'alimentation en pleine écriture laisse une ligne tronquée :
    // elle ne doit pas emporter tout l'historique avec elle.
    await service.record(makeEvent(), { seconds: 60, applied: true, reason: 'sub' }, state);

    const [file] = await readdir(directory);
    await writeFile(join(directory, file ?? ''), '{ tronqué\n', { flag: 'a' });

    await service.record(
      makeEvent({ id: 'evt-2' }),
      { seconds: 60, applied: true, reason: 'sub' },
      state,
    );

    expect((await service.list(10)).map((entry) => entry.id)).toEqual(['evt-2', 'evt-1']);
  });

  it("n'interrompt jamais le subathon si l'écriture échoue", async () => {
    // Le compteur prime sur son journal : un disque plein ne doit pas faire
    // remonter d'exception jusqu'au service compteur.
    const broken = createEventHistoryService({
      directory: join(directory, 'fichier-occupant'),
      logger: createLogger({ level: 'error', sinks: [SILENT_SINK] }),
      retentionDays: 90,
    });

    await writeFile(join(directory, 'fichier-occupant'), 'ce n’est pas un répertoire', 'utf8');

    await expect(
      broken.record(makeEvent(), { seconds: 60, applied: true, reason: 'sub' }, state),
    ).resolves.toBeUndefined();
  });

  it('purge les journaux au-delà de la rétention', async () => {
    await service.record(makeEvent(), { seconds: 60, applied: true, reason: 'sub' }, state);

    await expect(service.purge()).resolves.toBeTypeOf('number');
  });
});
