/**
 * Lecture de l'historique : filtrage, recherche, pagination, mise en forme.
 *
 * L'historique répond à une question que le streamer se pose forcément un
 * jour : « d'où viennent ces trois heures ? ». Une liste brute de plusieurs
 * centaines d'entrées n'y répond pas ; il faut pouvoir isoler un type, une
 * personne, ou — le plus utile — ce qui n'a **pas** été crédité.
 *
 * Tout ce qui décide vit ici : des comparaisons et des découpages, que le test
 * vérifie sans effort là où un clic les vérifie très mal. La vue ne fait que
 * peindre, et écrit par `safe-dom` — les pseudos viennent de Twitch, donc
 * d'inconnus.
 */

/**
 * Une entrée d'historique, telle que `GET /api/history` la renvoie.
 *
 * Redéclarée ici pour la même raison que le contrat de fil dans
 * `shared/protocol.ts` : `tsconfig.web.json` fixe `rootDir` à `src/web` et
 * refuse tout fichier du programme situé hors de cette racine, y compris
 * atteint par un `import type` pourtant effacé à la compilation.
 */
export interface HistoryEntry {
  readonly id: string;
  readonly type: 'sub' | 'resub' | 'gift' | 'bits' | 'raid' | 'follow' | 'command';
  readonly occurredAt: number;
  readonly recordedAt: number;
  readonly userId: string;
  /** Non assaini : `safe-dom` s'en charge à l'écriture. */
  readonly userName: string;
  readonly source: 'eventsub' | 'chat-notification' | 'manual' | 'chat-command';
  /** Palier, nombre de bits, de spectateurs ou de dons, selon le type. */
  readonly detail: string | number | null;
  readonly rewardSeconds: number;
  readonly applied: boolean;
  readonly reason: string;
  readonly remainingMsAfter: number;
}

export interface HistoryFilter {
  /** Type exact. Une chaîne vide vaut « tous les types ». */
  readonly type?: string;
  /** Vrai pour les seuls crédités, faux pour les seuls écartés. */
  readonly applied?: boolean;
  /** Fragment de pseudo, insensible à la casse. */
  readonly search?: string;
}

/**
 * Applique les filtres.
 *
 * La recherche est une **inclusion de sous-chaîne**, jamais une expression
 * régulière : un pseudo Twitch peut contenir n'importe quoi, et un `(` tapé
 * dans le champ ferait lever la construction du motif.
 */
export function filterHistory(
  entries: readonly HistoryEntry[],
  filter: HistoryFilter,
): readonly HistoryEntry[] {
  const search = filter.search?.trim().toLowerCase() ?? '';

  return entries.filter((entry) => {
    // Une chaîne vide vaut « tous les types » : la liste déroulante la rend
    // pour son option par défaut, et la traiter comme un type ferait
    // disparaître l'historique entier.
    if (filter.type !== undefined && filter.type !== '' && entry.type !== filter.type) {
      return false;
    }

    if (filter.applied !== undefined && entry.applied !== filter.applied) {
      return false;
    }

    return search === '' || entry.userName.toLowerCase().includes(search);
  });
}

export interface Page<T> {
  readonly items: readonly T[];
  /** Page réellement affichée, ramenée dans les bornes. */
  readonly page: number;
  /** Au moins 1 : « page 1 sur 0 » n'a pas de sens. */
  readonly pageCount: number;
}

/**
 * Découpe en pages.
 *
 * La page demandée est **ramenée dans les bornes** plutôt que refusée : un
 * filtre peut réduire la liste alors qu'on se trouve sur la dernière page, et
 * l'écran se viderait sans explication.
 */
export function paginate<T>(items: readonly T[], page: number, size: number): Page<T> {
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(0, Math.trunc(page)), pageCount - 1);
  const start = current * size;

  return { items: items.slice(start, start + size), page: current, pageCount };
}

/** Libellés des paliers, tels qu'ils s'écrivent dans l'historique. */
const TIER_LABELS: Readonly<Record<string, string>> = {
  tier1: 'Tier 1',
  tier2: 'Tier 2',
  tier3: 'Tier 3',
  prime: 'Prime',
};

/**
 * Décrit le détail d'une entrée en une phrase courte.
 *
 * Le détail vient d'un fichier sur le disque, qui a pu être écrit par une
 * version antérieure : un palier inconnu traverse **tel quel** plutôt que
 * d'être deviné ou remplacé.
 */
export function formatDetail(entry: HistoryEntry): string {
  if (entry.detail === null) {
    return '';
  }

  switch (entry.type) {
    case 'sub':
    case 'resub':
      return TIER_LABELS[String(entry.detail)] ?? String(entry.detail);
    case 'bits':
      return `${String(entry.detail)} bits`;
    case 'gift':
      return `${String(entry.detail)} abonnements offerts`;
    case 'raid':
      return `${String(entry.detail)} spectateurs`;
    case 'follow':
      return String(entry.detail);
    case 'command':
      // Le nom, préfixé, tel que le modérateur l'a tapé. Les secondes sont
      // déjà dans la colonne de la récompense : les répéter ici laisserait
      // croire à deux grandeurs différentes le jour où le plafond en écrête une.
      return `!${String(entry.detail)}`;
  }
}
