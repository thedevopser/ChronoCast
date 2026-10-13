import { describe, expect, it } from 'vitest';

import {
  applyMessage,
  counterControls,
  createDashboardModel,
  formatGoalCount,
  happyHourLabels,
  happyHourScheduleView,
  isResetArmed,
  MAX_RECENT_EVENTS,
  RESET_ARM_WINDOW_MS,
  resetLabel,
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
    expect(model.happyHour).toBe(false);
  });
});

describe('happyHourLabels', () => {
  it('dit qu’il est actif sans annoncer de multiplicateur, le barème Happy Hour étant réglable', () => {
    expect(happyHourLabels(true).state).toBe('Actif');
  });

  it('propose l’action inverse de l’état courant', () => {
    expect(happyHourLabels(true).action).toBe('Désactiver');
    expect(happyHourLabels(false).action).toBe('Activer');
  });

  it('nomme l’état éteint plutôt que de le laisser vide', () => {
    expect(happyHourLabels(false).state.trim()).not.toBe('');
    expect(happyHourLabels(false).state).not.toContain('×2');
  });
});

describe('plage du Happy Hour', () => {
  const NOW = new Date(2026, 9, 13, 18, 0).getTime();
  const SCHEDULE = {
    startAt: new Date(2026, 9, 13, 21, 0).getTime(),
    endAt: new Date(2026, 9, 14, 1, 0).getTime(),
  };

  function config(happyHourSchedule: typeof SCHEDULE | null, happyHour = false) {
    return {
      type: 'config' as const,
      overlay: {} as never,
      goalOverlay: {} as never,
      happyHour,
      happyHourSchedule,
    };
  }

  it('n’a aucune plage tant que le serveur n’en annonce pas', () => {
    expect(createDashboardModel().happyHourSchedule).toBeNull();
  });

  it('retient la plage annoncée à la connexion', () => {
    const model = applyMessage(createDashboardModel(), {
      type: 'hello',
      protocolVersion: 3,
      appVersion: '0.1.0',
      port: 3_777,
      wsPort: 3_777,
      overlay: {} as never,
      goalOverlay: {} as never,
      happyHour: false,
      happyHourSchedule: SCHEDULE,
    });

    expect(model.happyHourSchedule).toStrictEqual(SCHEDULE);
  });

  it('suit la pose puis l’annulation diffusées, pour que deux panneaux restent d’accord', () => {
    const posed = applyMessage(createDashboardModel(), config(SCHEDULE));
    expect(posed.happyHourSchedule).toStrictEqual(SCHEDULE);

    expect(applyMessage(posed, config(null)).happyHourSchedule).toBeNull();
  });

  it('ne repeint rien quand ni la bascule ni la plage n’ont changé', () => {
    const posed = applyMessage(createDashboardModel(), config(SCHEDULE));

    expect(applyMessage(posed, config({ ...SCHEDULE }))).toBe(posed);
  });

  describe('happyHourScheduleView', () => {
    it('propose de programmer quand il n’y a pas de plage', () => {
      expect(happyHourScheduleView(null, false, NOW)).toStrictEqual({
        summary: '',
        canSchedule: true,
        canCancel: false,
      });
    });

    it('affiche les deux bornes en clair, jour compris quand ce n’est pas aujourd’hui', () => {
      expect(happyHourScheduleView(SCHEDULE, false, NOW)).toStrictEqual({
        summary: 'Programmé de 21:00 à demain 01:00.',
        canSchedule: false,
        canCancel: true,
      });
    });

    it('dit pendant la plage que le Happy Hour est actif jusqu’à l’heure de fin', () => {
      const during = new Date(2026, 9, 13, 22, 0).getTime();

      expect(happyHourScheduleView(SCHEDULE, true, during).summary).toBe(
        'Actif jusqu’à demain 01:00.',
      );
    });

    it('dit pendant la plage qu’il a été éteint à la main, et quand la plage s’efface', () => {
      const during = new Date(2026, 9, 13, 22, 0).getTime();

      expect(happyHourScheduleView(SCHEDULE, false, during).summary).toBe(
        'Éteint à la main. La plage programmée s’efface à demain 01:00.',
      );
    });

    it('dit qu’un Happy Hour allumé avant le début sera éteint à la fin', () => {
      expect(happyHourScheduleView(SCHEDULE, true, NOW).summary).toBe(
        'Programmé de 21:00 à demain 01:00. Déjà actif : il s’éteindra à la fin de la plage.',
      );
    });
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
      goalOverlay: {} as never,
      happyHour: false,
      happyHourSchedule: null,
    });

    expect(model.appVersion).toBe('0.1.0');
    expect(model.port).toBe(3_777);
  });

  it('retient le Happy Hour annoncé par hello, qui survit à un redémarrage', () => {
    const model = applyMessage(createDashboardModel(), {
      type: 'hello',
      protocolVersion: 1,
      appVersion: '0.1.0',
      port: 3_777,
      wsPort: 3_777,
      overlay: {} as never,
      goalOverlay: {} as never,
      happyHour: true,
      happyHourSchedule: null,
    });

    expect(model.happyHour).toBe(true);
  });

  it('suit la bascule du Happy Hour diffusée après un enregistrement', () => {
    const active = applyMessage(createDashboardModel(), {
      type: 'config',
      overlay: {} as never,
      goalOverlay: {} as never,
      happyHour: true,
      happyHourSchedule: null,
    });

    expect(active.happyHour).toBe(true);

    const éteint = applyMessage(active, { type: 'config', overlay: {} as never, goalOverlay: {} as never, happyHour: false, happyHourSchedule: null });

    expect(éteint.happyHour).toBe(false);
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

  it('retient les portées manquantes annoncées par l’instantané', () => {
    const model = applyMessage(createDashboardModel(), {
      type: 'state',
      counter: counter('running'),
      twitch: { status: 'ready', missingScopes: ['user:read:chat', 'user:bot'] },
    });

    expect(model.missingScopes).toEqual(['user:read:chat', 'user:bot']);
  });

  it('oublie les portées manquantes dès que l’instantané n’en annonce plus', () => {
    const incomplet = applyMessage(createDashboardModel(), {
      type: 'state',
      counter: counter('running'),
      twitch: { status: 'ready', missingScopes: ['user:read:chat'] },
    });

    const reconnecte = applyMessage(incomplet, {
      type: 'state',
      counter: counter('running'),
      twitch: { status: 'ready' },
    });

    expect(reconnecte.missingScopes).toEqual([]);
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

describe('objectifs', () => {
  function goalMessage(overrides: Record<string, unknown> = {}): ServerMessage {
    return {
      type: 'goal',
      subs: 7,
      index: 1,
      total: 3,
      from: 5,
      to: 10,
      label: 'Karaoké',
      complete: false,
      crossed: [],
      ...overrides,
    };
  }

  it('part sans progression connue', () => {
    expect(createDashboardModel().goal).toBeNull();
  });

  it('retient la progression annoncée', () => {
    const model = applyMessage(createDashboardModel(), goalMessage());

    expect(model.goal).toMatchObject({ subs: 7, label: 'Karaoké', from: 5, to: 10 });
  });

  it('remplace la progression précédente', () => {
    const first = applyMessage(createDashboardModel(), goalMessage());
    const second = applyMessage(first, goalMessage({ subs: 12, label: 'Marathon' }));

    expect(second.goal?.subs).toBe(12);
  });

  it('rend le même modèle quand rien ne change, pour ne pas repeindre inutilement', () => {
    const first = applyMessage(createDashboardModel(), goalMessage());

    expect(applyMessage(first, goalMessage())).toBe(first);
  });
});

describe('remise à zéro en deux temps', () => {
  it('n’est pas armée tant que rien n’a été cliqué', () => {
    expect(isResetArmed(null, 10_000)).toBe(false);
  });

  it('est armée juste après le premier clic', () => {
    expect(isResetArmed(10_000, 10_100)).toBe(true);
  });

  it('se désarme toute seule passé le délai', () => {
    expect(isResetArmed(10_000, 10_000 + RESET_ARM_WINDOW_MS + 1)).toBe(false);
  });

  it('reste armée à la limite exacte du délai', () => {
    expect(isResetArmed(10_000, 10_000 + RESET_ARM_WINDOW_MS)).toBe(true);
  });

  it('annonce ce que le clic va faire', () => {
    expect(resetLabel(false)).not.toBe(resetLabel(true));
    expect(resetLabel(true).toLowerCase()).toContain('confirmer');
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

describe('formatGoalCount', () => {
  it('suit le compte du libellé d’unité choisi', () => {
    expect(formatGoalCount(12, 'abo.')).toBe('12 abo.');
    expect(formatGoalCount(125_000, 'points')).toBe('125000 points');
  });

  it('affiche le compte seul quand le libellé est vide ou fait d’espaces', () => {
    expect(formatGoalCount(12, '')).toBe('12');
    expect(formatGoalCount(12, '   ')).toBe('12');
  });
});
