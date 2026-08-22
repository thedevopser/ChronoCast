import { describe, expect, it } from 'vitest';

import { configSchema } from '../../../../src/core/config/schema.js';
import { announcementsOf, goalDisplay } from '../../../../src/web/goal/goal-view.js';
import type { GoalMessage, GoalOverlayConfig } from '../../../../src/web/shared/protocol.js';

function appearance(patch: Record<string, unknown> = {}): GoalOverlayConfig {
  return configSchema.parse({ goals: { overlay: patch } }).goals.overlay;
}

function message(patch: Partial<GoalMessage> = {}): GoalMessage {
  return {
    type: 'goal',
    subs: 12,
    index: 1,
    total: 3,
    from: 10,
    to: 50,
    label: 'Je me rase la tête',
    complete: false,
    crossed: [],
    ...patch,
  };
}

describe('goalDisplay', () => {
  it('montre le libellé du palier en cours et la part parcourue', () => {
    const view = goalDisplay(message(), appearance());

    expect(view.visible).toBe(true);
    expect(view.label).toBe('Je me rase la tête');
    expect(view.progress).toBeCloseTo(0.05);
  });

  it('inscrit le compte sous la forme « atteint / visé »', () => {
    expect(goalDisplay(message(), appearance()).count).toBe('12 / 50');
  });

  it('tait le compte quand le réglage l’éteint, sans toucher au libellé', () => {
    const view = goalDisplay(message(), appearance({ showCount: false }));

    expect(view.count).toBe('');
    expect(view.label).toBe('Je me rase la tête');
  });

  // Une échelle vide est l'état éteint des objectifs : la page se tait plutôt que de dessiner une
  // barre à zéro, qui laisserait croire à une promesse qui n'a jamais été faite.
  it('ne montre rien sur une échelle sans aucun palier', () => {
    const view = goalDisplay(
      message({ index: -1, total: 0, from: 0, to: 0, label: '', subs: 0 }),
      appearance(),
    );

    expect(view.visible).toBe(false);
  });

  it('reste plein sur son libellé final au-delà du dernier palier, et le compte continue', () => {
    const view = goalDisplay(
      message({ subs: 220, from: 100, to: 200, label: 'Je teins mes cheveux', complete: true }),
      appearance(),
    );

    expect(view.visible).toBe(true);
    expect(view.progress).toBe(1);
    expect(view.count).toBe('220 / 200');
    expect(view.label).toBe('Je teins mes cheveux');
  });

  it('rend zéro sur un palier de largeur nulle plutôt que de diviser par zéro', () => {
    expect(goalDisplay(message({ subs: 0, from: 0, to: 0 }), appearance()).progress).toBe(0);
  });

  it('rend le libellé tel quel, jamais interprété', () => {
    const hostile = '<img src=x onerror=alert(1)>';

    expect(goalDisplay(message({ label: hostile }), appearance()).label).toBe(hostile);
  });
});

describe('announcementsOf', () => {
  const CROSSED = [
    { target: 50, label: 'Je me rase la tête' },
    { target: 100, label: 'Je teins mes cheveux' },
  ];

  it('n’annonce rien quand aucun palier n’a été franchi', () => {
    expect(announcementsOf(message(), appearance())).toEqual([]);
  });

  // Un don groupé traverse l'échelle entière : chaque promesse intermédiaire a été faite, et
  // chacune doit pouvoir être annoncée.
  it('annonce chaque palier franchi, dans l’ordre', () => {
    const announcements = announcementsOf(message({ crossed: CROSSED }), appearance());

    expect(announcements.map((entry) => entry.label)).toEqual([
      'Je me rase la tête',
      'Je teins mes cheveux',
    ]);
  });

  it('reprend le texte réglé au-dessus de chaque libellé', () => {
    const announcements = announcementsOf(
      message({ crossed: CROSSED }),
      appearance({ announce: { text: 'Objectif débloqué' } }),
    );

    expect(announcements.every((entry) => entry.text === 'Objectif débloqué')).toBe(true);
  });

  it('accepte un texte vide : seul le libellé du palier s’affiche alors', () => {
    const [first] = announcementsOf(
      message({ crossed: CROSSED }),
      appearance({ announce: { text: '' } }),
    );

    expect(first?.text).toBe('');
    expect(first?.label).toBe('Je me rase la tête');
  });

  it('se tait quand l’annonce est éteinte', () => {
    expect(
      announcementsOf(message({ crossed: CROSSED }), appearance({ announce: { enabled: false } })),
    ).toEqual([]);
  });

  it('donne une identité distincte à chaque palier, sans quoi la file les confondrait', () => {
    const ids = announcementsOf(message({ crossed: CROSSED }), appearance()).map(
      (entry) => entry.id,
    );

    expect(new Set(ids).size).toBe(ids.length);
  });
});
