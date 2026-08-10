import { describe, expect, it } from 'vitest';

import {
  filterHistory,
  formatDetail,
  paginate,
  type HistoryEntry,
} from '../../../../src/web/admin/history-view.js';

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: 'e1',
    type: 'sub',
    occurredAt: 1_000,
    recordedAt: 1_000,
    userId: 'u1',
    userName: 'alice',
    source: 'eventsub',
    detail: 'tier1',
    rewardSeconds: 180,
    applied: true,
    reason: 'abonnement tier 1',
    remainingMsAfter: 3_600_000,
    ...overrides,
  };
}

const ENTRIES: readonly HistoryEntry[] = [
  entry({ id: 'a', type: 'sub', userName: 'alice', applied: true }),
  entry({ id: 'b', type: 'bits', userName: 'Bob', applied: true, detail: 500, rewardSeconds: 360 }),
  entry({ id: 'c', type: 'gift', userName: 'carol', applied: false, rewardSeconds: 0, detail: 10 }),
  entry({ id: 'd', type: 'follow', userName: 'dave', applied: false, rewardSeconds: 0, detail: null }),
];

describe('filterHistory', () => {
  it('rend tout quand aucun filtre n’est posé', () => {
    expect(filterHistory(ENTRIES, {})).toHaveLength(4);
  });

  it('filtre par type', () => {
    expect(filterHistory(ENTRIES, { type: 'bits' }).map((item) => item.id)).toEqual(['b']);
  });

  it('ne filtre pas sur un type vide', () => {
    expect(filterHistory(ENTRIES, { type: '' })).toHaveLength(4);
  });

  it('filtre les événements crédités', () => {
    expect(filterHistory(ENTRIES, { applied: true }).map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('filtre les événements non crédités', () => {
    expect(filterHistory(ENTRIES, { applied: false }).map((item) => item.id)).toEqual(['c', 'd']);
  });

  it('recherche par pseudo, sans tenir compte de la casse', () => {
    expect(filterHistory(ENTRIES, { search: 'bob' }).map((item) => item.id)).toEqual(['b']);
  });

  it('recherche sur un fragment', () => {
    expect(filterHistory(ENTRIES, { search: 'ar' }).map((item) => item.id)).toEqual(['c']);
  });

  it('ignore les espaces autour de la recherche', () => {
    expect(filterHistory(ENTRIES, { search: '  alice  ' }).map((item) => item.id)).toEqual(['a']);
  });

  it('ne traite pas la recherche comme une expression régulière', () => {
    expect(() => filterHistory(ENTRIES, { search: '([' })).not.toThrow();
    expect(filterHistory(ENTRIES, { search: '.*' })).toHaveLength(0);
  });

  it('combine les filtres', () => {
    expect(
      filterHistory(ENTRIES, { applied: false, search: 'dave' }).map((item) => item.id),
    ).toEqual(['d']);
  });

  it('ne modifie pas la liste reçue', () => {
    const snapshot = JSON.stringify(ENTRIES);
    filterHistory(ENTRIES, { type: 'sub' });

    expect(JSON.stringify(ENTRIES)).toBe(snapshot);
  });
});

describe('paginate', () => {
  const many = Array.from({ length: 25 }, (_, index) => entry({ id: `e${String(index)}` }));

  it('découpe en pages', () => {
    expect(paginate(many, 0, 10).items).toHaveLength(10);
    expect(paginate(many, 2, 10).items).toHaveLength(5);
  });

  it('compte les pages', () => {
    expect(paginate(many, 0, 10).pageCount).toBe(3);
  });

  it('annonce une page unique pour une liste vide', () => {
    const page = paginate([], 0, 10);

    expect(page.pageCount).toBe(1);
    expect(page.page).toBe(0);
    expect(page.items).toEqual([]);
  });

  it('ramène une page hors bornes dans les bornes', () => {
    const page = paginate(many, 99, 10);

    expect(page.page).toBe(2);
    expect(page.items).toHaveLength(5);
  });

  it('refuse une page négative', () => {
    expect(paginate(many, -3, 10).page).toBe(0);
  });
});

describe('formatDetail', () => {
  it('nomme les paliers d’abonnement', () => {
    expect(formatDetail(entry({ type: 'sub', detail: 'tier1' }))).toContain('Tier 1');
    expect(formatDetail(entry({ type: 'sub', detail: 'prime' }))).toContain('Prime');
  });

  it('compte les bits', () => {
    expect(formatDetail(entry({ type: 'bits', detail: 500 }))).toContain('500');
  });

  it('compte les dons', () => {
    expect(formatDetail(entry({ type: 'gift', detail: 10 }))).toContain('10');
  });

  it('compte les spectateurs d’un raid', () => {
    expect(formatDetail(entry({ type: 'raid', detail: 42 }))).toContain('42');
  });

  it('rend une chaîne vide quand il n’y a rien à dire', () => {
    expect(formatDetail(entry({ type: 'follow', detail: null }))).toBe('');
  });

  it('n’invente rien pour un palier inconnu', () => {
    expect(formatDetail(entry({ type: 'sub', detail: 'tier9' }))).toContain('tier9');
  });
});
