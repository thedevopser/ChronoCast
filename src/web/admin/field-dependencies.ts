import { groupOf } from './fields.js';
import type { FieldDescriptor, RawValue } from './form-binding.js';

/**
 * Une règle grise ses cibles quand **aucune** de ses conditions n'est satisfaite.
 *
 * `when` désigne des réglages dont la valeur courante décide, `mutes` les réglages qui n'ont alors
 * plus d'effet. Sans cela, rien ne distingue à l'écran un champ actif d'un champ que l'overlay
 * n'ira jamais lire.
 */
export interface DependencyRule {
  readonly when: readonly string[];
  readonly satisfied: (values: readonly RawValue[]) => boolean;
  readonly mutes: readonly string[];
}

const anyTrue = (values: readonly RawValue[]): boolean => values.some((value) => value === true);

function enables(prefix: string, leaves: readonly string[]): DependencyRule {
  return {
    when: [`${prefix}.enabled`],
    satisfied: anyTrue,
    mutes: leaves.map((leaf) => `${prefix}.${leaf}`),
  };
}

export const DEPENDENCIES: readonly DependencyRule[] = [
  enables('overlay.shadow', ['color', 'blur', 'offsetX', 'offsetY']),
  enables('overlay.outline', ['color', 'width']),
  enables('overlay.glow', ['color', 'radius']),
  enables('overlay.frame', [
    'color',
    'width',
    'radius',
    'paddingX',
    'paddingY',
    'fillColor',
    'fillOpacity',
  ]),
  enables('overlay.toast', ['durationMs', 'color', 'fontSize']),

  {
    when: ['overlay.gradient.onText', 'overlay.gradient.onFrame'],
    satisfied: anyTrue,
    mutes: ['overlay.gradient.from', 'overlay.gradient.to', 'overlay.gradient.angleDeg'],
  },

  // Le dégradé recouvre entièrement le trait du cadre : la couleur est alors ignorée.
  {
    when: ['overlay.gradient.onFrame'],
    satisfied: (values) => !anyTrue(values),
    mutes: ['overlay.frame.color'],
  },

  {
    when: ['overlay.animation.onAdd'],
    satisfied: (values) => values.some((value) => value !== 'none'),
    mutes: ['overlay.animation.durationMs'],
  },

  enables('goals.overlay.shadow', ['color', 'blur', 'offsetX', 'offsetY']),
  enables('goals.overlay.outline', ['color', 'width']),
  enables('goals.overlay.glow', ['color', 'radius']),
  enables('goals.overlay.announce', ['durationMs', 'color', 'text']),

  {
    when: ['goals.overlay.gradient.onText', 'goals.overlay.gradient.onBar'],
    satisfied: anyTrue,
    mutes: [
      'goals.overlay.gradient.from',
      'goals.overlay.gradient.to',
      'goals.overlay.gradient.angleDeg',
    ],
  },

  // Le dégradé recouvre entièrement le remplissage de la barre : sa couleur est alors ignorée.
  {
    when: ['goals.overlay.gradient.onBar'],
    satisfied: (values) => !anyTrue(values),
    mutes: ['goals.overlay.bar.fillColor'],
  },
];

export function mutedSelectors(
  fields: readonly FieldDescriptor[],
  values: Readonly<Record<string, RawValue>>,
): readonly string[] {
  const selectorOf = new Map(fields.map((field) => [field.path, field.selector]));
  const muted = new Set<string>();

  for (const rule of DEPENDENCIES) {
    const observed: RawValue[] = [];

    for (const path of rule.when) {
      const selector = selectorOf.get(path);
      const value = selector === undefined ? undefined : values[selector];
      if (value !== undefined) {
        observed.push(value);
      }
    }

    if (observed.length === 0 || rule.satisfied(observed)) {
      continue;
    }

    for (const path of rule.mutes) {
      const selector = selectorOf.get(path);
      if (selector !== undefined) {
        muted.add(selector);
      }
    }
  }

  return [...muted];
}

const MASTER_SWITCH = '.enabled';

/**
 * Nomme les groupes dont l'interrupteur principal est éteint, pour les replier.
 *
 * La décision ne se prend qu'au repeint du formulaire, jamais à la frappe : recalculer à chaque
 * touche refermerait sous les doigts un groupe que l'utilisateur vient d'ouvrir.
 */
export function inactiveGroups(
  fields: readonly FieldDescriptor[],
  values: Readonly<Record<string, RawValue>>,
): readonly string[] {
  const inactive = new Set<string>();

  for (const field of fields) {
    if (!field.path.endsWith(MASTER_SWITCH) || values[field.selector] !== false) {
      continue;
    }

    inactive.add(groupOf(field.path));
  }

  return [...inactive];
}
