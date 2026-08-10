import { describe, expect, it } from 'vitest';

import {
  patchFrom,
  readAtPath,
  valuesFrom,
  writeAtPath,
  type FieldDescriptor,
} from '../../../../src/web/admin/form-binding.js';

const CONFIG = {
  counter: { initialSeconds: 43_200, resumeOnStartup: true },
  rewards: {
    sub: { tier1: 180, tier2: 240 },
    bits: { mode: 'linear' },
    chatCommand: { overlayText: 'Temps ajouté' },
  },
  overlay: { color: '#FFFFFF', fontFamily: 'Inter', letterSpacing: 0 },
};

const FIELDS: readonly FieldDescriptor[] = [
  { selector: '#tier1', path: 'rewards.sub.tier1', kind: 'integer', min: 0 },
  { selector: '#tier2', path: 'rewards.sub.tier2', kind: 'integer', min: 0 },
  { selector: '#resume', path: 'counter.resumeOnStartup', kind: 'boolean' },
  { selector: '#color', path: 'overlay.color', kind: 'color' },
  { selector: '#font', path: 'overlay.fontFamily', kind: 'text' },
  { selector: '#spacing', path: 'overlay.letterSpacing', kind: 'number' },
  { selector: '#mode', path: 'rewards.bits.mode', kind: 'enum', options: ['linear', 'tiers'] },
  { selector: '#label', path: 'rewards.chatCommand.overlayText', kind: 'text', allowEmpty: true },
];

function pristine(): Record<string, string | boolean> {
  return valuesFrom(FIELDS, CONFIG);
}

describe('readAtPath', () => {
  it('lit une valeur imbriquée', () => {
    expect(readAtPath(CONFIG, 'rewards.sub.tier1')).toBe(180);
  });

  it('lit une valeur de premier niveau', () => {
    expect(readAtPath({ a: 1 }, 'a')).toBe(1);
  });

  it('renvoie undefined pour un chemin absent', () => {
    expect(readAtPath(CONFIG, 'rewards.sub.tier9')).toBeUndefined();
    expect(readAtPath(CONFIG, 'absent.completement')).toBeUndefined();
  });

  it('ne traverse pas une valeur qui n’est pas un objet', () => {
    expect(readAtPath({ a: 3 }, 'a.b')).toBeUndefined();
    expect(readAtPath(null, 'a')).toBeUndefined();
  });

  it('ne remonte jamais la chaîne de prototypes', () => {
    expect(readAtPath({}, 'constructor')).toBeUndefined();
    expect(readAtPath({}, 'toString')).toBeUndefined();
    expect(readAtPath({}, '__proto__')).toBeUndefined();
  });
});

describe('writeAtPath', () => {
  it('crée les niveaux manquants', () => {
    const target = {};
    writeAtPath(target, 'rewards.sub.tier1', 200);

    expect(target).toEqual({ rewards: { sub: { tier1: 200 } } });
  });

  it('complète un niveau déjà présent sans l’écraser', () => {
    const target = { rewards: { sub: { tier1: 200 } } };
    writeAtPath(target, 'rewards.sub.tier2', 300);

    expect(target).toEqual({ rewards: { sub: { tier1: 200, tier2: 300 } } });
  });

  it.each(['__proto__', 'constructor', 'prototype'])(
    'refuse le segment %s',
    (segment) => {
      expect(() => { writeAtPath({}, `rewards.${segment}.x`, 1); }).toThrow();
      expect(() => { writeAtPath({}, `${segment}.x`, 1); }).toThrow();
    },
  );

  it('ne pollue pas le prototype global', () => {
    expect(() => { writeAtPath({}, '__proto__.pollue', true); }).toThrow();
    expect(({} as Record<string, unknown>)['pollue']).toBeUndefined();
  });

  it('refuse un chemin vide ou malformé', () => {
    expect(() => { writeAtPath({}, '', 1); }).toThrow();
    expect(() => { writeAtPath({}, 'a..b', 1); }).toThrow();
  });
});

describe('valuesFrom', () => {
  it('rend les nombres sous forme de chaîne, prêts pour un champ', () => {
    const values = pristine();

    expect(values['#tier1']).toBe('180');
    expect(values['#spacing']).toBe('0');
  });

  it('rend les booléens tels quels, pour une case à cocher', () => {
    expect(pristine()['#resume']).toBe(true);
  });

  it('rend le texte, la couleur et l’énumération tels quels', () => {
    const values = pristine();

    expect(values['#color']).toBe('#FFFFFF');
    expect(values['#font']).toBe('Inter');
    expect(values['#mode']).toBe('linear');
  });

  it('omet un champ dont le chemin est absent de la configuration', () => {
    const values = valuesFrom(FIELDS, { rewards: { sub: { tier1: 5 } } });

    expect(values['#tier1']).toBe('5');
    expect('#color' in values).toBe(false);
  });
});

describe('patchFrom', () => {
  it('ne renvoie rien quand rien n’a changé', () => {
    const { patch, errors } = patchFrom(FIELDS, pristine(), CONFIG);

    expect(patch).toEqual({});
    expect(errors).toEqual([]);
  });

  it('ne renvoie que les champs modifiés', () => {
    const { patch } = patchFrom(FIELDS, { ...pristine(), '#tier1': '240' }, CONFIG);

    expect(patch).toEqual({ rewards: { sub: { tier1: 240 } } });
  });

  it('regroupe plusieurs modifications dans un seul objet imbriqué', () => {
    const { patch } = patchFrom(
      FIELDS,
      { ...pristine(), '#tier1': '240', '#tier2': '300', '#resume': false },
      CONFIG,
    );

    expect(patch).toEqual({
      rewards: { sub: { tier1: 240, tier2: 300 } },
      counter: { resumeOnStartup: false },
    });
  });

  it('accepte la virgule comme séparateur décimal', () => {
    const { patch, errors } = patchFrom(FIELDS, { ...pristine(), '#spacing': '1,5' }, CONFIG);

    expect(errors).toEqual([]);
    expect(patch).toEqual({ overlay: { letterSpacing: 1.5 } });
  });

  it('accepte un entier négatif quand aucune borne ne l’interdit', () => {
    const fields: FieldDescriptor[] = [{ selector: '#o', path: 'overlay.offsetY', kind: 'integer' }];
    const { patch, errors } = patchFrom(fields, { '#o': '-4' }, { overlay: { offsetY: 0 } });

    expect(errors).toEqual([]);
    expect(patch).toEqual({ overlay: { offsetY: -4 } });
  });

  describe('saisies refusées', () => {
    it.each([
      ['#tier1', 'abc', 'un entier non numérique'],
      ['#tier1', '', 'un champ vidé'],
      ['#tier1', '1.5', 'un décimal là où un entier est attendu'],
      ['#tier1', '-1', 'un entier sous la borne minimale'],
      ['#spacing', 'beaucoup', 'un nombre non numérique'],
      ['#color', 'rouge', 'une couleur qui n’est pas hexadécimale'],
      ['#color', '#12345', 'une couleur de longueur invalide'],
      ['#mode', 'aleatoire', 'une valeur hors de l’énumération'],
    ])('refuse %s = %o : %s', (selector, raw) => {
      const { patch, errors } = patchFrom(FIELDS, { ...pristine(), [selector]: raw }, CONFIG);

      expect(errors).toHaveLength(1);
      expect(errors[0]?.selector).toBe(selector);
      expect(errors[0]?.message).not.toBe('');
      expect(patch).toEqual({});
    });

    it('rapporte chaque champ fautif, pas seulement le premier', () => {
      const { errors } = patchFrom(
        FIELDS,
        { ...pristine(), '#tier1': 'abc', '#color': 'rouge' },
        CONFIG,
      );

      expect(errors.map((entry) => entry.selector).sort()).toEqual(['#color', '#tier1']);
    });

    it('refuse un booléen reçu sous forme de chaîne', () => {
      const { errors } = patchFrom(FIELDS, { ...pristine(), '#resume': 'on' }, CONFIG);

      expect(errors).toHaveLength(1);
      expect(errors[0]?.selector).toBe('#resume');
    });

    it('applique la borne maximale', () => {
      const fields: FieldDescriptor[] = [
        { selector: '#p', path: 'server.httpPort', kind: 'integer', min: 1, max: 65_535 },
      ];
      const { errors } = patchFrom(fields, { '#p': '70000' }, { server: { httpPort: 3_777 } });

      expect(errors).toHaveLength(1);
    });
  });

  it('ignore un champ absent des valeurs brutes', () => {
    const { patch, errors } = patchFrom(FIELDS, { '#tier1': '240' }, CONFIG);

    expect(errors).toEqual([]);
    expect(patch).toEqual({ rewards: { sub: { tier1: 240 } } });
  });

  it('refuse un champ texte vidé', () => {
    const { errors, patch } = patchFrom(FIELDS, { ...pristine(), '#font': '' }, CONFIG);

    expect(errors).toHaveLength(1);
    expect(patch).toEqual({});
  });

  it('accepte un champ texte vidé lorsqu’il l’autorise', () => {
    const { errors, patch } = patchFrom(FIELDS, { ...pristine(), '#label': '' }, CONFIG);

    expect(errors).toEqual([]);
    expect(patch).toEqual({ rewards: { chatCommand: { overlayText: '' } } });
  });

  it('conserve un texte contenant du HTML sans le transformer', () => {
    const hostile = '<script>alert(1)</script>';
    const { patch } = patchFrom(FIELDS, { ...pristine(), '#font': hostile }, CONFIG);

    expect(patch).toEqual({ overlay: { fontFamily: hostile } });
  });
});
