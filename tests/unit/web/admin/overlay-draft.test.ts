import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '../../../../src/core/config/defaults.js';
import { ADMIN_FIELDS, fieldsOf } from '../../../../src/web/admin/fields.js';
import { valuesFrom, type RawValue } from '../../../../src/web/admin/form-binding.js';
import { draftOverlayConfig, draftSubtree } from '../../../../src/web/admin/overlay-draft.js';
import type { GoalOverlayConfig, OverlayConfig } from '../../../../src/web/shared/protocol.js';

const APPEARANCE = fieldsOf('appearance');

function pristine(): Record<string, RawValue> {
  return valuesFrom(APPEARANCE, DEFAULT_CONFIG);
}

function draft(patch: Record<string, RawValue> = {}): OverlayConfig {
  const outcome = draftOverlayConfig(APPEARANCE, { ...pristine(), ...patch }, DEFAULT_CONFIG);
  if (outcome === null) {
    throw new Error('brouillon attendu sur une configuration complète');
  }
  return outcome;
}

describe('draftOverlayConfig', () => {
  it('rend la configuration enregistrée quand rien n’a été touché', () => {
    expect(draft()).toStrictEqual(DEFAULT_CONFIG.overlay);
  });

  it('reporte un champ modifié, à la racine comme dans une branche', () => {
    const outcome = draft({ '#overlay-color': '#FFCC00', '#overlay-frame-radius': '42' });

    expect(outcome.color).toBe('#FFCC00');
    expect(outcome.frame.radius).toBe(42);
  });

  it('reporte une case à cocher', () => {
    expect(draft({ '#overlay-frame-enabled': true }).frame.enabled).toBe(true);
    expect(draft({ '#overlay-show-days': false }).showDays).toBe(false);
  });

  it('reporte une énumération', () => {
    expect(draft({ '#overlay-text-align': 'right' }).textAlign).toBe('right');
  });

  it('garde la valeur enregistrée pour un champ invalide, au lieu de tout rejeter', () => {
    const outcome = draft({ '#overlay-color': 'rouge vif', '#overlay-font-size': '120' });

    expect(outcome.color).toBe(DEFAULT_CONFIG.overlay.color);
    expect(outcome.fontSize).toBe(120);
  });

  it('garde la valeur enregistrée pour un champ vidé en cours de frappe', () => {
    expect(draft({ '#overlay-font-size': '' }).fontSize).toBe(DEFAULT_CONFIG.overlay.fontSize);
    expect(draft({ '#overlay-font-family': '' }).fontFamily).toBe(
      DEFAULT_CONFIG.overlay.fontFamily,
    );
  });

  it('garde la valeur enregistrée pour un champ hors bornes', () => {
    expect(draft({ '#overlay-frame-width': '999' }).frame.width).toBe(
      DEFAULT_CONFIG.overlay.frame.width,
    );
  });

  it('ignore une valeur brute absente', () => {
    const partial = { '#overlay-color': '#000000' };

    expect(draftOverlayConfig(APPEARANCE, partial, DEFAULT_CONFIG)).toStrictEqual({
      ...DEFAULT_CONFIG.overlay,
      color: '#000000',
    });
  });

  it('ignore les champs des autres vues', () => {
    const outcome = draftOverlayConfig(
      ADMIN_FIELDS,
      { ...pristine(), '#counter-initial': '1' },
      DEFAULT_CONFIG,
    );

    expect(outcome).toStrictEqual(DEFAULT_CONFIG.overlay);
  });

  it('ne modifie jamais la configuration enregistrée', () => {
    const before = structuredClone(DEFAULT_CONFIG.overlay);

    draft({ '#overlay-color': '#FFCC00', '#overlay-frame-radius': '42' });

    expect(DEFAULT_CONFIG.overlay).toStrictEqual(before);
  });

  it('rend toujours une configuration complète, même sur une source vide', () => {
    expect(draftOverlayConfig(APPEARANCE, {}, DEFAULT_CONFIG)).toStrictEqual(
      DEFAULT_CONFIG.overlay,
    );
  });

  it('se tait plutôt que de rendre une configuration incomplète', () => {
    expect(draftOverlayConfig(APPEARANCE, pristine(), {})).toBeNull();
    expect(draftOverlayConfig(APPEARANCE, pristine(), null)).toBeNull();
    expect(draftOverlayConfig(APPEARANCE, pristine(), { overlay: 'tout blanc' })).toBeNull();
  });
});

describe('draftSubtree', () => {
  const GOAL_APPEARANCE = fieldsOf('goal-appearance');

  function goalPristine(): Record<string, RawValue> {
    return valuesFrom(GOAL_APPEARANCE, DEFAULT_CONFIG);
  }

  function goalDraft(patch: Record<string, RawValue> = {}): GoalOverlayConfig {
    const outcome = draftSubtree(
      'goals.overlay.',
      GOAL_APPEARANCE,
      { ...goalPristine(), ...patch },
      DEFAULT_CONFIG,
    );
    if (outcome === null) {
      throw new Error('brouillon attendu sur une configuration complète');
    }
    return outcome as unknown as GoalOverlayConfig;
  }

  // Le sous-arbre visé n'est plus à la racine : il faut descendre `goals.` avant de le trouver.
  it('atteint un sous-arbre imbriqué', () => {
    expect(goalDraft()).toStrictEqual(DEFAULT_CONFIG.goals.overlay);
  });

  it('reporte un champ modifié, à la racine du sous-arbre comme dans une branche', () => {
    const outcome = goalDraft({ '#goal-color': '#FFCC00', '#goal-bar-radius': '42' });

    expect(outcome.color).toBe('#FFCC00');
    expect(outcome.bar.radius).toBe(42);
  });

  it('ignore les champs qui ne sont pas sous le préfixe', () => {
    const outcome = draftSubtree(
      'goals.overlay.',
      ADMIN_FIELDS,
      { ...goalPristine(), '#goal-bits-per-sub': '1', '#overlay-color': '#000000' },
      DEFAULT_CONFIG,
    );

    expect(outcome).toStrictEqual(DEFAULT_CONFIG.goals.overlay);
  });

  it('ne modifie jamais la configuration enregistrée', () => {
    const before = structuredClone(DEFAULT_CONFIG.goals.overlay);

    goalDraft({ '#goal-color': '#FFCC00' });

    expect(DEFAULT_CONFIG.goals.overlay).toStrictEqual(before);
  });

  it('se tait plutôt que de rendre une configuration incomplète', () => {
    expect(draftSubtree('goals.overlay.', GOAL_APPEARANCE, goalPristine(), {})).toBeNull();
    expect(
      draftSubtree('goals.overlay.', GOAL_APPEARANCE, goalPristine(), { goals: {} }),
    ).toBeNull();
  });

  it('sert aussi le sous-arbre de l’overlay du compteur, qui n’est qu’un cas du même geste', () => {
    expect(draftSubtree('overlay.', APPEARANCE, pristine(), DEFAULT_CONFIG)).toStrictEqual(
      DEFAULT_CONFIG.overlay,
    );
  });
});
