import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import { DEFAULT_CONFIG } from '../../../../src/core/config/defaults.js';

const HTML = readFileSync(resolve(process.cwd(), 'src/web/admin/index.html'), 'utf8')
  .replace('__CHRONOCAST_CSRF__', 'a'.repeat(64))
  .replace('__CHRONOCAST_WS_PORT__', '3777');

interface FakeSocket {
  onmessage: ((event: { data: string }) => void) | null;
  listeners: Record<string, ((event: unknown) => void)[]>;
}

const sockets: FakeSocket[] = [];
const requests: { method: string; url: string; body: string | null }[] = [];
let scheduleResponse: () => Response = () => new Response('{"schedule":null}', { status: 200 });
let pendingNotice: unknown = { goalsReset: { previousCount: 37 } };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function deliver(message: unknown): void {
  for (const socket of sockets) {
    for (const listener of socket.listeners['message'] ?? []) {
      listener({ data: JSON.stringify(message) });
    }
  }
}

function element(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (found === null) {
    throw new Error(`introuvable : ${selector}`);
  }
  return found;
}

function field(selector: string): HTMLInputElement {
  return element(selector) as HTMLInputElement;
}

async function settle(): Promise<void> {
  for (let round = 0; round < 10; round += 1) {
    await new Promise((done) => setTimeout(done, 0));
  }
}

const HELLO = {
  type: 'hello',
  protocolVersion: 3,
  appVersion: '1.4.0',
  port: 3777,
  wsPort: 3777,
  overlay: DEFAULT_CONFIG.overlay,
  goalOverlay: DEFAULT_CONFIG.goals.overlay,
  happyHour: false,
  happyHourSchedule: null,
};

// La page réelle du panneau, chargée une fois pour tout le fichier.
beforeAll(async () => {
  // Les aperçus encadrés restent dans la page, mais n'ont pas à charger /overlay ni /goal ici.
  (
    window as unknown as { happyDOM: { settings: { disableIframePageLoading: boolean } } }
  ).happyDOM.settings.disableIframePageLoading = true;

  const parsed = new DOMParser().parseFromString(HTML, 'text/html');
  document.head.replaceChildren(...parsed.head.querySelectorAll('meta'));
  document.body.replaceChildren(...parsed.body.children);
  for (const script of document.querySelectorAll('script')) {
    script.remove();
  }

  vi.stubGlobal(
    'WebSocket',
    class {
      public listeners: Record<string, ((event: unknown) => void)[]> = {};
      public onmessage = null;
      public readyState = 1;
      public constructor() {
        sockets.push(this);
        setTimeout(() => {
          for (const listener of this.listeners['open'] ?? []) {
            listener({});
          }
        }, 0);
      }
      public addEventListener(type: string, listener: (event: unknown) => void): void {
        (this.listeners[type] ??= []).push(listener);
      }
      public send(): void {
        // Rien n'est attendu du serveur factice.
      }
      public close(): void {
        // Idem.
      }
    },
  );

  window.fetch = ((input: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    requests.push({ method, url: input, body: typeof init?.body === 'string' ? init.body : null });

    if (input === '/api/happy-hour/schedule') {
      return Promise.resolve(scheduleResponse());
    }
    if (input === '/api/update-notice') {
      return Promise.resolve(json({ notice: pendingNotice }));
    }
    if (input === '/api/update-notice/acknowledge') {
      pendingNotice = null;
      return Promise.resolve(json({ notice: null }));
    }
    if (input === '/api/config') {
      return Promise.resolve(json({ config: DEFAULT_CONFIG, hasClientSecret: false }));
    }
    return Promise.resolve(json({ entries: [], records: [], subscriptions: [], goal: null, tiers: [] }));
  }) as typeof window.fetch;

  await import('../../../../src/web/admin/main.js');
  await settle();
  deliver(HELLO);
  await settle();
});

describe('annonce de mise à jour sur le tableau de bord', () => {
  it('s’affiche tant qu’elle est en attente, avec l’ancien compte de la barre', () => {
    const notice = element('#update-notice');

    expect(notice.hidden).toBe(false);
    expect(element('#view-dashboard').contains(notice)).toBe(true);
    expect(element('#update-notice-goals').textContent).toContain('37');
  });

  it('disparaît quand on l’acquitte', async () => {
    element('#update-notice-ack').click();
    await settle();

    expect(requests.some((request) => request.url === '/api/update-notice/acknowledge')).toBe(true);
    expect(element('#update-notice').hidden).toBe(true);
  });
});

describe('carte Happy Hour du tableau de bord', () => {
  it('envoie la plage saisie quand on clique sur Programmer', async () => {
    field('#happy-hour-start').value = '21:00';
    field('#happy-hour-end').value = '23:00';

    element('#happy-hour-schedule').click();
    await settle();

    const put = requests.find((request) => request.method === 'PUT');
    expect(put?.url).toBe('/api/happy-hour/schedule');
    expect(JSON.parse(put?.body ?? '{}')).toMatchObject({
      startAt: expect.any(Number) as number,
      endAt: expect.any(Number) as number,
    });
  });

  it('affiche la plage diffusée, masque le formulaire et propose l’annulation', async () => {
    const now = Date.now();
    deliver({
      type: 'config',
      overlay: DEFAULT_CONFIG.overlay,
      goalOverlay: DEFAULT_CONFIG.goals.overlay,
      happyHour: false,
      happyHourSchedule: { startAt: now + 3_600_000, endAt: now + 7_200_000 },
    });
    await settle();

    const summary = element('#happy-hour-schedule-summary');
    expect(summary.hidden).toBe(false);
    expect(summary.textContent).toContain('Programmé de');
    expect(element('#happy-hour-schedule-form').hidden).toBe(true);
    expect(element('#happy-hour-cancel').hidden).toBe(false);
  });

  it('écrit le refus de l’API à côté des champs, saisie intacte', async () => {
    deliver({ ...HELLO, type: 'config' });
    await settle();
    scheduleResponse = () => json({ error: 'Plage refusée : la fin doit être dans le futur.', code: 'invalid_schedule' }, 400);

    element('#happy-hour-schedule').click();
    await settle();

    expect(element('#happy-hour-schedule-error').textContent).toContain('Plage refusée');
    expect(field('#happy-hour-start').value).toBe('21:00');
  });

  it('annule la plage par DELETE', async () => {
    element('#happy-hour-cancel').click();
    await settle();

    expect(requests.some((request) => request.method === 'DELETE')).toBe(true);
  });
});

describe('vue Happy Hour', () => {
  const view = (): HTMLElement => element('#view-happy-hour');

  it('figure dans le menu, après le barème', () => {
    const entries = [...document.querySelectorAll<HTMLAnchorElement>('#nav a')].map(
      (entry) => entry.dataset['view'],
    );

    expect(entries.indexOf('happy-hour')).toBe(entries.indexOf('rewards') + 1);
  });

  it('porte la programmation de la plage, qui n’est plus sur le tableau de bord', () => {
    for (const selector of ['#happy-hour-schedule-form', '#happy-hour-cancel', '#happy-hour-schedule-error']) {
      expect(view().contains(element(selector)), selector).toBe(true);
    }
    expect(element('#view-dashboard').querySelector('input[type="time"]')).toBeNull();
  });

  it('porte le barème Happy Hour, que la vue Barème ne montre plus', () => {
    expect(view().contains(element('#reward-hh-sub-tier1'))).toBe(true);
    expect(view().contains(element('#reward-hh-bits-unit'))).toBe(true);
    expect(view().contains(element('#reward-hh-bits-seconds'))).toBe(true);
    expect(element('#view-rewards').querySelector('[id^="reward-hh-"]')).toBeNull();
  });

  it('ne propose plus ni mode de calcul, ni seuil, ni paliers de bits', () => {
    for (const selector of [
      '#bits-tiers',
      '#hh-bits-tiers',
      '#reward-bits-mode',
      '#reward-hh-bits-mode',
      '#reward-bits-min',
      '#reward-hh-bits-min',
    ]) {
      expect(document.querySelector(selector), selector).toBeNull();
    }
  });

  it('enregistre le taux des bits de chaque barème par le bouton de sa vue', async () => {
    field('#reward-bits-unit').value = '1';
    field('#reward-bits-seconds').value = '2';
    const before = requests.filter((request) => request.method === 'PATCH').length;

    element('#save-rewards').click();
    await settle();

    // Un enregistrement recharge la configuration et repeint toutes les vues : la saisie de la
    // seconde vue se fait donc après.
    field('#reward-hh-bits-seconds').value = '300';
    element('#save-happy-hour').click();
    await settle();

    const patches = requests
      .filter((request) => request.method === 'PATCH')
      .slice(before)
      .map((request) => JSON.parse(request.body ?? '{}') as unknown);
    expect(patches[0]).toStrictEqual({ config: { rewards: { bits: { unit: 1, seconds: 2 } } } });
    expect(patches[1]).toMatchObject({
      config: { rewards: { happyHourRewards: { bits: { seconds: 300 } } } },
    });
  });

  it('affiche l’état et la plage au même titre que le tableau de bord', async () => {
    const now = Date.now();
    deliver({
      ...HELLO,
      type: 'config',
      happyHour: true,
      happyHourSchedule: { startAt: now - 60_000, endAt: now + 3_600_000 },
    });
    await settle();

    for (const prefix of ['#happy-hour', '#hh-view']) {
      expect(element(`${prefix}-status`).textContent, prefix).toBe('Actif');
      expect(element(`${prefix}-toggle`).textContent, prefix).toBe('Désactiver');
    }
    expect(element('#happy-hour-schedule-summary').textContent).toContain('Actif jusqu’à');
    expect(element('#hh-view-summary').textContent).toContain('Actif jusqu’à');
  });

  it('bascule le Happy Hour depuis la vue comme depuis le tableau de bord', async () => {
    const before = requests.filter((request) => request.method === 'PATCH').length;

    element('#hh-view-toggle').click();
    await settle();
    element('#happy-hour-toggle').click();
    await settle();

    const patches = requests.filter((request) => request.method === 'PATCH').slice(before);
    expect(patches).toHaveLength(2);
    expect(JSON.parse(patches[0]?.body ?? '{}')).toStrictEqual({
      config: { rewards: { happyHour: false } },
    });
  });

  it('enregistre son barème par son propre bouton', async () => {
    field('#reward-hh-sub-tier1').value = '777';
    const before = requests.filter((request) => request.method === 'PATCH').length;

    element('#save-happy-hour').click();
    await settle();

    const patch = requests.filter((request) => request.method === 'PATCH').slice(before)[0];
    expect(JSON.parse(patch?.body ?? '{}')).toStrictEqual({
      config: { rewards: { happyHourRewards: { sub: { tier1: 777 } } } },
    });
  });
});

describe('gestes de copie du panneau', () => {
  it('recopie une carte du barème dans les deux autres, sans rien enregistrer', () => {
    field('#reward-sub-tier1').value = '321';
    const before = requests.length;

    const copy = [...document.querySelectorAll<HTMLButtonElement>('#fields-rewards button')].find(
      (candidate) => candidate.closest('.group')?.contains(element('#reward-sub-tier1')) === true,
    );
    copy?.click();

    expect(field('#reward-resub-tier1').value).toBe('321');
    expect(field('#reward-gift-tier1').value).toBe('321');
    expect(requests).toHaveLength(before);
  });

  it('pose un bouton de copie sur chaque carte des trois barèmes', () => {
    const cards = [
      '#reward-sub-tier1',
      '#reward-resub-tier1',
      '#reward-gift-tier1',
      '#reward-hh-sub-tier1',
      '#reward-hh-resub-tier1',
      '#reward-hh-gift-tier1',
      '#goal-points-sub-tier1',
      '#goal-points-resub-tier1',
      '#goal-points-gift-tier1',
    ];

    for (const selector of cards) {
      expect(element(selector).closest('.group')?.querySelector('button'), selector).not.toBeNull();
    }
  });
});
