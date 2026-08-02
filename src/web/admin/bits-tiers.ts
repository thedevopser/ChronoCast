/**
 * Paliers de bits.
 *
 * Seul réglage à cardinalité variable du schéma, et donc le seul que
 * `form-binding.ts` ne prend pas en charge : on n'y saisit pas une valeur mais
 * une liste, qu'on allonge et qu'on raccourcit. Il lui faut sa propre
 * conversion, et c'est tout ce que fait ce module — la vue s'occupe des lignes.
 *
 * Deux règles viennent du barème lui-même (`core/counter/reward-engine.ts`) :
 *
 * - il **tolère n'importe quel ordre** et retient le palier atteint le plus
 *   généreux. Trier est donc un confort de lecture, pas une correction — mais
 *   c'est en relisant une liste ordonnée qu'on repère un seuil aberrant ;
 * - il **départage mal deux paliers de même seuil** : son `reduce` compare avec
 *   un `>` strict et garde donc le premier des ex æquo, c'est-à-dire un ordre
 *   de saisie que rien n'affiche. Le doublon est une ambiguïté réelle et se
 *   refuse ici, où l'on peut encore l'expliquer.
 */

/** Une ligne de l'éditeur, telle que la vue la lit dans ses deux champs. */
export interface TierInput {
  readonly minBits: string;
  readonly seconds: string;
}

export interface BitsTier {
  readonly minBits: number;
  readonly seconds: number;
}

export interface TiersResult {
  /** Paliers triés par seuil croissant. Vide dès qu'une erreur est trouvée. */
  readonly tiers: readonly BitsTier[];
  /** Phrases françaises, affichables telles quelles. */
  readonly errors: readonly string[];
}

const INTEGER = /^\d+$/;

/** Vrai si la ligne n'a été qu'ajoutée puis abandonnée. */
function isBlank(row: TierInput): boolean {
  return row.minBits.trim() === '' && row.seconds.trim() === '';
}

/**
 * Convertit les lignes de l'éditeur en paliers.
 *
 * Ne rend aucun palier tant qu'une ligne est fautive : enregistrer les autres
 * laisserait un barème à moitié appliqué, et le streamer croirait avoir tout
 * réglé. Chaque message nomme la ligne concernée — sur une liste de dix, un
 * message anonyme oblige à tout relire.
 */
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

    // Le seuil est strictement positif : un palier à zéro bit s'appliquerait à
    // un cheer de zéro bit, ce qui n'existe pas, et masquerait tous les autres.
    if (!INTEGER.test(minBits) || Number(minBits) < 1) {
      errors.push(`Palier ${position} : seuil en bits attendu, entier et supérieur à zéro.`);
      return;
    }

    // La récompense peut être nulle : c'est un moyen légitime de neutraliser
    // une tranche sans la supprimer de la liste.
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
    // Contrainte du schéma : le mode « tiers » sans palier ne crédite jamais
    // rien. Le refus de Zod arriverait sans dire lequel des champs est en cause.
    errors.push('Le mode par paliers exige au moins un palier.');
  }

  return errors.length > 0
    ? { tiers: [], errors }
    : { tiers: [...tiers].sort((left, right) => left.minBits - right.minBits), errors };
}
