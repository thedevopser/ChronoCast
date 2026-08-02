/**
 * Tampon et filtrage des journaux affichés.
 *
 * Les journaux diffèrent de l'historique sur un point qui change tout : ils
 * **arrivent en continu** par le canal `log` du WebSocket, pendant qu'on les
 * lit. Trois conséquences, et ce module existe pour les trois.
 *
 * **Le tampon est plafonné.** Six heures de direct en niveau debug finiraient
 * par saturer l'onglet, et un panneau qu'on garde ouvert sur un second écran
 * n'a pas le droit de grossir indéfiniment. Ce sont les plus anciens qui
 * partent : un journal consulté en direct sert à voir ce qui vient d'arriver.
 *
 * **Le filtre de niveau est un seuil minimal**, pas une égalité. Chercher les
 * avertissements sans voir les erreurs n'aurait aucun sens, et c'est déjà la
 * sémantique retenue par `routes/api.ts` côté serveur : les deux doivent
 * s'accorder, sinon le rechargement changerait ce que la page affiche.
 *
 * **Les portées sont imbriquées.** Demander `twitch` ramène `twitch:eventsub`,
 * faute de quoi le filtre obligerait à connaître l'arborescence des composants
 * pour s'en servir.
 */

/**
 * Un enregistrement de journal, tel que `GET /api/logs` et le canal `log` le
 * renvoient. Redéclaré ici, comme le reste du contrat côté navigateur.
 */
export interface LogRecord {
  /** Horodatage ISO 8601 en UTC. */
  readonly timestamp: string;
  readonly level: string;
  /** Chemin du composant émetteur, par exemple `twitch:eventsub`. */
  readonly scope: string;
  readonly message: string;
  readonly context?: unknown;
}

/**
 * Plafond du tampon.
 *
 * Volontairement plus large que le tampon circulaire du serveur — 500 par
 * défaut — puisque la page accumule aussi ce qui arrive au fil de l'eau après
 * le chargement initial.
 */
export const MAX_LOG_RECORDS = 2_000;

/** Niveaux, du plus bavard au plus grave. L'ordre **est** la comparaison. */
const LEVELS: readonly string[] = ['debug', 'info', 'warning', 'error'];

export interface LogBuffer {
  readonly records: readonly LogRecord[];
}

export function createLogBuffer(): LogBuffer {
  return { records: [] };
}

/**
 * Ajoute des enregistrements, en écartant les plus anciens au-delà du plafond.
 *
 * Rend le tampon **identique par référence** quand il n'y a rien à ajouter,
 * comme les réducteurs du noyau : la vue s'en sert pour ne pas repeindre une
 * liste inchangée.
 */
export function appendRecords(buffer: LogBuffer, records: readonly LogRecord[]): LogBuffer {
  if (records.length === 0) {
    return buffer;
  }

  const merged = [...buffer.records, ...records];
  return { records: merged.slice(Math.max(0, merged.length - MAX_LOG_RECORDS)) };
}

export interface LogFilter {
  /** Niveau **minimal**. Vide ou inconnu vaut « tous les niveaux ». */
  readonly level?: string;
  /** Portée, préfixe compris. Vide vaut « toutes les portées ». */
  readonly scope?: string;
  /** Fragment de message, insensible à la casse. */
  readonly search?: string;
}

/** Applique les filtres. La recherche est une inclusion, jamais un motif. */
export function filterRecords(
  records: readonly LogRecord[],
  filter: LogFilter,
): readonly LogRecord[] {
  // Un niveau inconnu laisse tout passer plutôt que de tout masquer : une
  // page vide et muette est le pire des retours.
  const threshold = LEVELS.indexOf(filter.level ?? '');
  const scope = filter.scope?.trim() ?? '';
  const search = filter.search?.trim().toLowerCase() ?? '';

  return records.filter((record) => {
    if (threshold >= 0 && LEVELS.indexOf(record.level) < threshold) {
      return false;
    }

    // Préfixe et non égalité : `twitch` doit ramener `twitch:eventsub`.
    if (scope !== '' && !record.scope.startsWith(scope)) {
      return false;
    }

    return search === '' || record.message.toLowerCase().includes(search);
  });
}

/** Portées présentes dans le tampon, triées et sans doublon. */
export function scopesOf(records: readonly LogRecord[]): readonly string[] {
  return [...new Set(records.map((record) => record.scope))].sort((left, right) =>
    left.localeCompare(right),
  );
}
