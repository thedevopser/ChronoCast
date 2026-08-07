import { describe, expect, it } from 'vitest';

import {
  applyMessage,
  counterControls,
  createDashboardModel,
  MAX_RECENT_EVENTS,
  statusLabel,
  twitchLabel,
  type DashboardModel,
} from '../../../../src/web/admin/dashboard-model.js';
import type {
  CounterState,
  CounterStatus,
  DomainEvent,
  ServerMessage,
} from '../../../../src/web/shared/protocol.js';

function counter(status: CounterStatus, remainingMs = 3_600_000): CounterState {
  return {
    remainingMs,
    status,
    initialMs: 43_200_000,
    totalAddedMs: 0,
    totalRemovedMs: 0,
    startedAt: status === 'idle' ? null : 1_000,
    finishedAt: status === 'finished' ? 2_000 : null,
    updatedAt: 2_000,
    schemaVersion: 1,
  };
}

function subEvent(id: string, userName = 'ninja'): DomainEvent {
  return { id, type: 'sub', occurredAt: 1_000, userId: 'u1', userName, source: 'eventsub', tier: 'tier1' };
}

function eventMessage(event: DomainEvent, rewardSeconds = 180, applied = true): ServerMessage {
  return { type: 'event', event, rewardSeconds, applied };
}

describe('createDashboardModel', () => {
  it('part d’un état vide et cohérent', () => {
    const model = createDashboardModel();

    expect(model.counter).toBeNull();
    expect(model.events).toEqual([]);
    expect(model.twitch.status).toBe('disconnected');
    expect(model.appVersion).toBe('');
  });
});

describe('applyMessage', () => {
  it('retient le compteur et la version annoncés par hello', () => {
    const model = applyMessage(createDashboardModel(), {
      type: 'hello',
      protocolVersion: 1,
      appVersion: '0.1.0',
      port: 3_777,
      wsPort: 3_777,
      overlay: {} as never,
    });

    expect(model.appVersion).toBe('0.1.0');
    expect(model.port).toBe(3_777);
  });

  it('retient l’instantané complet', () => {
    const model = applyMessage(createDashboardModel(), {
      type: 'state',
      counter: counter('running'),
      twitch: { status: 'ready', detail: 'connecté' },
    });

    expect(model.counter?.status).toBe('running');
    expect(model.twitch).toEqual({ status: 'ready', detail: 'connecté' });
  });

  it('suit les changements de compteur', () => {
    const model = applyMessage(createDashboardModel(), {
      type: 'counter',
      state: counter('paused'),
      origin: 'manual',
      deltaMs: 0,
      reason: 'pause manuelle',
    });

    expect(model.counter?.status).toBe('paused');
  });

  it('suit le statut Twitch', () => {
    const model = applyMessage(createDashboardModel(), {
      type: 'twitch:status',
      status: 'reconnecting',
      detail: 'session expirée',
    });

    expect(model.twitch).toEqual({ status: 'reconnecting', detail: 'session expirée' });
  });

  it('remplace un détail absent par une chaîne vide', () => {
    const model = applyMessage(createDashboardModel(), { type: 'twitch:status', status: 'ready' });

    expect(model.twitch.detail).toBe('');
  });

  it('empile les événements, le plus récent d’abord', () => {
    let model = createDashboardModel();
    model = applyMessage(model, eventMessage(subEvent('a', 'alice')));
    model = applyMessage(model, eventMessage(subEvent('b', 'bob')));

    expect(model.events.map((entry) => entry.userName)).toEqual(['bob', 'alice']);
  });

  it('plafonne la liste des événements', () => {
    let model = createDashboardModel();
    for (let index = 0; index < MAX_RECENT_EVENTS + 4; index += 1) {
      model = applyMessage(model, eventMessage(subEvent(`e${String(index)}`)));
    }

    expect(model.events).toHaveLength(MAX_RECENT_EVENTS);
  });

  it('ignore un événement déjà connu', () => {
    let model = applyMessage(createDashboardModel(), eventMessage(subEvent('a')));
    const before = model.events;
    model = applyMessage(model, eventMessage(subEvent('a')));

    expect(model.events).toBe(before);
  });

  it('retient aussi les événements non crédités', () => {
    const model = applyMessage(createDashboardModel(), eventMessage(subEvent('a'), 0, false));

    expect(model.events[0]?.applied).toBe(false);
    expect(model.events[0]?.rewardSeconds).toBe(0);
  });

  it('conserve le pseudo tel quel, sans le nettoyer', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const model = applyMessage(createDashboardModel(), eventMessage(subEvent('a', hostile)));

    expect(model.events[0]?.userName).toBe(hostile);
  });

  it.each<ServerMessage>([
    { type: 'pong' },
    { type: 'log', record: { timestamp: '', level: 'info', scope: 's', message: 'm' } },
    { type: 'error', code: 'x', message: 'y' },
  ])('renvoie le même modèle pour un message sans effet : %o', (message) => {
    const model = createDashboardModel();

    expect(applyMessage(model, message)).toBe(model);
  });

  it('renvoie le même modèle quand l’instantané ne change rien', () => {
    const snapshot: ServerMessage = {
      type: 'state',
      counter: counter('running'),
      twitch: { status: 'ready' },
    };
    const model = applyMessage(createDashboardModel(), snapshot);

    expect(applyMessage(model, snapshot)).toBe(model);
  });
});

describe('counterControls', () => {
  it.each<[CounterStatus, boolean, boolean]>([
    ['idle', false, true],
    ['running', true, false],
    ['paused', false, true],
    ['finished', false, true],
  ])('pour %s : pause=%o reprise=%o', (status, canPause, canResume) => {
    const controls = counterControls(counter(status));

    expect(controls.canPause).toBe(canPause);
    expect(controls.canResume).toBe(canResume);
  });

  it('tout est inerte tant que l’état n’est pas connu', () => {
    const controls = counterControls(null);

    expect(controls).toEqual({ canPause: false, canResume: false, canReset: false });
  });

  it('la remise à zéro reste possible dès que l’état est connu', () => {
    for (const status of ['idle', 'running', 'paused', 'finished'] as const) {
      expect(counterControls(counter(status)).canReset).toBe(true);
    }
  });
});

describe('libellés', () => {
  it.each<CounterStatus>(['idle', 'running', 'paused', 'finished'])(
    'donne un libellé français non vide pour %s',
    (status) => {
      expect(statusLabel(status)).not.toBe('');
    },
  );

  it('distingue chaque statut de compteur', () => {
    const labels = (['idle', 'running', 'paused', 'finished'] as const).map(statusLabel);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('distingue chaque statut Twitch', () => {
    const labels = (
      ['disconnected', 'connecting', 'connected', 'ready', 'reconnecting'] as const
    ).map(twitchLabel);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('immuabilité', () => {
  it('ne modifie jamais le modèle reçu', () => {
    const model: DashboardModel = createDashboardModel();
    const snapshot = JSON.stringify(model);

    applyMessage(model, eventMessage(subEvent('a')));
    applyMessage(model, { type: 'twitch:status', status: 'ready' });

    expect(JSON.stringify(model)).toBe(snapshot);
  });
});
