import type { FieldViewId } from './router.js';

/**
 * Les deux pages servies à OBS se règlent au même endroit, chacune sous son onglet et avec son
 * propre aperçu : la vue Objectifs reste celle des promesses, et non celle des couleurs.
 *
 * Un onglet **est** une vue à champs, ce qui lui donne sans câblage son conteneur `#fields-<id>`,
 * son bouton `#save-<id>` et son jeu de descripteurs.
 */
export const APPEARANCE_TABS = ['appearance', 'goal-appearance'] as const satisfies readonly FieldViewId[];

export type AppearanceTabId = (typeof APPEARANCE_TABS)[number];

export const DEFAULT_APPEARANCE_TAB: AppearanceTabId = 'appearance';

export const APPEARANCE_TAB_LABELS: Readonly<Record<AppearanceTabId, string>> = {
  appearance: 'Compteur',
  'goal-appearance': 'Barre d’objectif',
};

export function tabFromValue(value: string | undefined): AppearanceTabId {
  return (APPEARANCE_TABS as readonly string[]).includes(value ?? '')
    ? (value as AppearanceTabId)
    : DEFAULT_APPEARANCE_TAB;
}
