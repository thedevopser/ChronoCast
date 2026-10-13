export interface TierInput {
  readonly minBits: string;
  readonly seconds: string;
}

export interface BitsTier {
  readonly minBits: number;
  readonly seconds: number;
}

export interface TiersChange {
  /** Les paliers à écrire, ou `null` quand il n'y a rien à écrire. */
  readonly tiers: readonly BitsTier[] | null;
  readonly errors: readonly string[];
}

export interface TiersResult {
  readonly tiers: readonly BitsTier[];
  readonly errors: readonly string[];
}

const INTEGER = /^\d+$/;

function isBlank(row: TierInput): boolean {
  return row.minBits.trim() === '' && row.seconds.trim() === '';
}

export function normalizeTiers(rows: readonly TierInput[]): TiersResult {
  const errors: string[] = [];
  const tiers: BitsTier[] = [];
  const seen = new Set<number>();

  rows.forEach((row, index) => {
    if (isBlank(row)) {
      return;
    }

    const position = String(index + 1);
    const minBits = row.minBits.trim();
    const seconds = row.seconds.trim();

    if (!INTEGER.test(minBits) || Number(minBits) < 1) {
      errors.push(`Palier ${position} : seuil en bits attendu, entier et supérieur à zéro.`);
      return;
    }

    if (!INTEGER.test(seconds)) {
      errors.push(`Palier ${position} : durée en secondes attendue, entière et positive ou nulle.`);
      return;
    }

    const threshold = Number(minBits);

    if (seen.has(threshold)) {
      errors.push(
        `Palier ${position} : le seuil ${minBits} est déjà défini plus haut. Deux paliers de même seuil rendraient la récompense imprévisible.`,
      );
      return;
    }

    seen.add(threshold);
    tiers.push({ minBits: threshold, seconds: Number(seconds) });
  });

  if (errors.length === 0 && tiers.length === 0) {
    errors.push('Le mode par paliers exige au moins un palier.');
  }

  return errors.length > 0
    ? { tiers: [], errors }
    : { tiers: [...tiers].sort((left, right) => left.minBits - right.minBits), errors };
}

const TIERS_MODE = 'tiers';

/**
 * Ce que l'éditeur de paliers demande d'écrire, au regard du mode choisi et des paliers en place.
 *
 * Hors du mode par paliers, une liste laissée vide n'est pas une faute ; dans ce mode elle l'est,
 * et il faut l'arrêter ici : le schéma la refuserait au chargement, configuration entière avec.
 */
export function tiersChange(
  rows: readonly TierInput[],
  mode: string | undefined,
  current: unknown,
): TiersChange {
  if (mode !== TIERS_MODE && rows.every(isBlank)) {
    return { tiers: null, errors: [] };
  }

  const { tiers, errors } = normalizeTiers(rows);
  if (errors.length > 0) {
    return { tiers: null, errors };
  }

  return JSON.stringify(tiers) === JSON.stringify(current)
    ? { tiers: null, errors: [] }
    : { tiers, errors: [] };
}
