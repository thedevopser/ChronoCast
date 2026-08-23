// Redéclarée : src/web ne peut rien importer du noyau, pas même une constante, qui traverserait
// rootDir. Un test tient l'alignement avec le schéma.
export const GOAL_LABEL_MAX_LENGTH = 40;

export interface GoalTierInput {
  readonly target: string;
  readonly label: string;
}

export interface GoalTier {
  readonly target: number;
  readonly label: string;
}

export interface GoalTiersResult {
  readonly tiers: readonly GoalTier[];
  readonly errors: readonly string[];
}

const INTEGER = /^\d+$/;

export type GoalSubsResult = { readonly subs: number } | { readonly error: string };

/**
 * Lit le compte d'abonnements saisi. Un champ vide est refusé plutôt qu'entendu comme zéro :
 * `Number('')` vaut 0, et une saisie oubliée effacerait la progression au lieu de ne rien faire.
 */
export function parseGoalSubs(raw: string): GoalSubsResult {
  const value = raw.trim();

  if (!INTEGER.test(value)) {
    return {
      error: 'Nombre d’abonnements attendu : un entier positif ou zéro.',
    };
  }

  return { subs: Number(value) };
}

function isBlank(row: GoalTierInput): boolean {
  return row.target.trim() === '' && row.label.trim() === '';
}

export function normalizeGoalTiers(rows: readonly GoalTierInput[]): GoalTiersResult {
  const errors: string[] = [];
  const tiers: GoalTier[] = [];
  const seen = new Set<number>();

  rows.forEach((row, index) => {
    if (isBlank(row)) {
      return;
    }

    const position = String(index + 1);
    const target = row.target.trim();
    const label = row.label.trim();

    if (!INTEGER.test(target) || Number(target) < 1) {
      errors.push(`Palier ${position} : seuil en abonnements attendu, entier et supérieur à zéro.`);
      return;
    }

    if (label === '') {
      errors.push(
        `Palier ${position} : libellé attendu. Sans promesse annoncée, un palier n’a rien à afficher.`,
      );
      return;
    }

    if (label.length > GOAL_LABEL_MAX_LENGTH) {
      errors.push(
        `Palier ${position} : libellé limité à ${String(GOAL_LABEL_MAX_LENGTH)} caractères pour tenir sur une ligne.`,
      );
      return;
    }

    const threshold = Number(target);

    if (seen.has(threshold)) {
      errors.push(
        `Palier ${position} : le seuil ${target} est déjà défini plus haut. Deux paliers de même seuil rendraient la promesse imprévisible.`,
      );
      return;
    }

    seen.add(threshold);
    tiers.push({ target: threshold, label });
  });

  // Une échelle vide est légitime, à la différence des paliers de bits : c'est l'état éteint des
  // objectifs, et non une configuration incomplète.
  return errors.length > 0
    ? { tiers: [], errors }
    : { tiers: [...tiers].sort((left, right) => left.target - right.target), errors };
}
