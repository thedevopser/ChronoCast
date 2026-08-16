import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '../../../../src/core/config/defaults.js';
import { fieldsOf } from '../../../../src/web/admin/fields.js';
import {
  DEPENDENCIES,
  inactiveGroups,
  mutedSelectors,
} from '../../../../src/web/admin/field-dependencies.js';
import { valuesFrom, type RawValue } from '../../../../src/web/admin/form-binding.js';

const APPEARANCE = fieldsOf('appearance');

function pristine(): Record<string, RawValue> {
  return valuesFrom(APPEARANCE, DEFAULT_CONFIG);
}

function muted(patch: Record<string, RawValue> = {}): readonly string[] {
  return mutedSelectors(APPEARANCE, { ...pristine(), ...patch });
}

describe('mutedSelectors', () => {
  it('grise les réglages d’un effet éteint, et eux seuls', () => {
    const outcome = muted({ '#overlay-shadow-enabled': false });

    expect(outcome).toContain('#overlay-shadow-color');
    expect(outcome).toContain('#overlay-shadow-blur');
    expect(outcome).toContain('#overlay-shadow-offset-x');
    expect(outcome).toContain('#overlay-shadow-offset-y');
    expect(outcome).not.toContain('#overlay-shadow-enabled');
    expect(outcome).not.toContain('#overlay-color');
  });

  it('ne grise rien quand l’effet est allumé', () => {
    expect(muted({ '#overlay-shadow-enabled': true })).not.toContain('#overlay-shadow-color');
  });

  it('traite de la même façon contour, halo, cadre et bulles', () => {
    expect(muted({ '#overlay-outline-enabled': false })).toContain('#overlay-outline-width');
    expect(muted({ '#overlay-glow-enabled': false })).toContain('#overlay-glow-radius');
    expect(muted({ '#overlay-frame-enabled': false })).toContain('#overlay-frame-radius');
    expect(muted({ '#overlay-toast-enabled': false })).toContain('#overlay-toast-duration');
  });

  it('ne grise le dégradé que s’il ne porte ni sur le texte ni sur le cadre', () => {
    const off = { '#overlay-gradient-on-text': false, '#overlay-gradient-on-frame': false };

    expect(muted(off)).toContain('#overlay-gradient-from');
    expect(muted(off)).toContain('#overlay-gradient-to');
    expect(muted(off)).toContain('#overlay-gradient-angle');

    expect(muted({ ...off, '#overlay-gradient-on-text': true })).not.toContain(
      '#overlay-gradient-from',
    );
    expect(muted({ ...off, '#overlay-gradient-on-frame': true })).not.toContain(
      '#overlay-gradient-from',
    );
  });

  it('grise la couleur du cadre quand le dégradé le recouvre', () => {
    const framed = { '#overlay-frame-enabled': true };

    expect(muted({ ...framed, '#overlay-gradient-on-frame': true })).toContain(
      '#overlay-frame-color',
    );
    expect(muted({ ...framed, '#overlay-gradient-on-frame': false })).not.toContain(
      '#overlay-frame-color',
    );
  });

  it('grise la durée d’une animation absente', () => {
    expect(muted({ '#overlay-animation-on-add': 'none' })).toContain('#overlay-animation-duration');
    expect(muted({ '#overlay-animation-on-add': 'pulse' })).not.toContain(
      '#overlay-animation-duration',
    );
  });

  it('ne grise rien sur la configuration par défaut hormis les effets éteints', () => {
    const outcome = muted();

    expect(outcome).toContain('#overlay-outline-width');
    expect(outcome).toContain('#overlay-glow-radius');
    expect(outcome).toContain('#overlay-frame-radius');
    expect(outcome).not.toContain('#overlay-shadow-blur');
    expect(outcome).not.toContain('#overlay-toast-duration');
  });

  it('ne rend jamais deux fois le même sélecteur', () => {
    const outcome = muted({ '#overlay-frame-enabled': false, '#overlay-gradient-on-frame': true });

    expect(new Set(outcome).size).toBe(outcome.length);
  });

  it('se tait quand les valeurs manquent', () => {
    expect(mutedSelectors(APPEARANCE, {})).toEqual([]);
  });
});

describe('DEPENDENCIES', () => {
  it('ne cite que des chemins réellement liés à un champ', () => {
    const bound = new Set(APPEARANCE.map((field) => field.path));

    for (const rule of DEPENDENCIES) {
      for (const path of rule.when) {
        expect(bound, `condition ${path}`).toContain(path);
      }
      for (const path of rule.mutes) {
        expect(bound, `cible ${path}`).toContain(path);
      }
    }
  });

  it('ne grise jamais le réglage qui commande la règle', () => {
    for (const rule of DEPENDENCIES) {
      for (const path of rule.when) {
        expect(rule.mutes).not.toContain(path);
      }
    }
  });
});

describe('inactiveGroups', () => {
  function inactive(patch: Record<string, RawValue> = {}): readonly string[] {
    return inactiveGroups(APPEARANCE, { ...pristine(), ...patch });
  }

  it('nomme les groupes dont l’interrupteur est éteint', () => {
    expect(inactive()).toContain('Contour');
    expect(inactive()).toContain('Halo');
    expect(inactive()).toContain('Cadre');
  });

  it('laisse actif un groupe dont l’interrupteur est allumé', () => {
    expect(inactive()).not.toContain('Ombre portée');
    expect(inactive()).not.toContain('Bulles d’annonce');
  });

  it('suit l’interrupteur quand il change', () => {
    expect(inactive({ '#overlay-frame-enabled': true })).not.toContain('Cadre');
    expect(inactive({ '#overlay-toast-enabled': false })).toContain('Bulles d’annonce');
  });

  it('ne nomme jamais un groupe sans interrupteur', () => {
    expect(inactive()).not.toContain('Texte du compteur');
    expect(inactive()).not.toContain('Animation');
    expect(inactive()).not.toContain('Dégradé');
  });

  it('se tait quand les valeurs manquent', () => {
    expect(inactiveGroups(APPEARANCE, {})).toEqual([]);
  });
});
