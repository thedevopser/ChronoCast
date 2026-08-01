/**
 * Cache anti-doublons à fenêtre glissante.
 *
 * Twitch retransmet des événements : la documentation EventSub est explicite,
 * une même notification peut arriver plusieurs fois et c'est au client de s'en
 * prémunir. Sans ce cache, un seul abonnement pourrait créditer six minutes au
 * lieu de trois — défaut invisible en développement, coûteux en direct.
 *
 * Le même mécanisme sert deux usages, avec des fenêtres différentes :
 *
 *   - **identifiants de message**, sur une fenêtre longue, contre les
 *     retransmissions de Twitch ;
 *   - **clé sémantique** du type `sub:12345:tier1`, sur une fenêtre courte,
 *     contre le double comptage entre `channel.subscribe` et
 *     `channel.chat.notification`, qui décrivent le même abonnement.
 *
 * Le contenu est sérialisable et rechargeable : un redémarrage pendant une salve
 * de gift subs ne doit pas rouvrir la porte aux doublons.
 */

/** Entrée persistée : une clé et l'instant où elle a été admise. */
export interface DedupEntry {
  readonly key: string;
  /** Instant d'admission, en millisecondes depuis l'époque. */
  readonly seenAt: number;
}

export interface DedupCache {
  /**
   * Tente d'enregistrer une clé.
   *
   * @returns `true` si la clé est nouvelle — l'événement doit être traité —,
   *          `false` s'il s'agit d'un doublon.
   */
  admit(key: string, now: number): boolean;

  /** Indique si la clé est connue, sans jamais l'enregistrer. */
  has(key: string, now: number): boolean;

  /** Retire les entrées expirées. Renvoie leur nombre. */
  purge(now: number): number;

  /** Nombre d'entrées actuellement conservées. */
  size(): number;

  /** Contenu sérialisable, destiné à la persistance. */
  toSnapshot(): DedupEntry[];

  /**
   * Recharge un contenu persisté.
   *
   * Tolérant par construction : le fichier vient du disque et peut avoir été
   * tronqué par une coupure. Toute entrée inexploitable est écartée sans bruit
   * plutôt que de faire échouer le démarrage.
   */
  loadSnapshot(snapshot: unknown, now: number): void;
}

export interface DedupCacheOptions {
  /** Nombre maximal d'entrées conservées, éviction des plus anciennes au-delà. */
  readonly maxEntries: number;

  /** Durée pendant laquelle une clé reste considérée comme vue. */
  readonly ttlMs: number;
}

/** Vrai si l'entrée brute a la forme attendue. */
function isValidEntry(value: unknown): value is DedupEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['key'] === 'string' &&
    candidate['key'] !== '' &&
    typeof candidate['seenAt'] === 'number' &&
    Number.isFinite(candidate['seenAt'])
  );
}

export function createDedupCache(options: DedupCacheOptions): DedupCache {
  const { maxEntries, ttlMs } = options;

  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new RangeError(`capacité invalide : ${String(maxEntries)} (entier positif attendu)`);
  }
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new RangeError(`fenêtre invalide : ${String(ttlMs)} ms (durée positive attendue)`);
  }

  /**
   * Une `Map` préserve l'ordre d'insertion : la première clé itérée est donc la
   * plus anciennement admise, ce qui suffit à implémenter l'éviction sans
   * structure supplémentaire.
   */
  const entries = new Map<string, number>();

  function isExpired(seenAt: number, now: number): boolean {
    return now - seenAt >= ttlMs;
  }

  /** Évince les plus anciennes jusqu'à revenir sous la capacité. */
  function enforceCapacity(): void {
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next();
      if (oldest.done === true) {
        return;
      }
      entries.delete(oldest.value);
    }
  }

  return {
    admit(key: string, now: number): boolean {
      const seenAt = entries.get(key);

      if (seenAt !== undefined && !isExpired(seenAt, now)) {
        // Volontairement sans réarmement de la fenêtre : une retransmission
        // insistante ne doit pas maintenir l'entrée en vie indéfiniment.
        return false;
      }

      entries.delete(key);
      entries.set(key, now);
      enforceCapacity();
      return true;
    },

    has(key: string, now: number): boolean {
      const seenAt = entries.get(key);
      return seenAt !== undefined && !isExpired(seenAt, now);
    },

    purge(now: number): number {
      let removed = 0;
      for (const [key, seenAt] of entries) {
        if (isExpired(seenAt, now)) {
          entries.delete(key);
          removed += 1;
        }
      }
      return removed;
    },

    size(): number {
      return entries.size;
    },

    toSnapshot(): DedupEntry[] {
      return [...entries].map(([key, seenAt]) => ({ key, seenAt }));
    },

    loadSnapshot(snapshot: unknown, now: number): void {
      if (!Array.isArray(snapshot)) {
        return;
      }

      for (const candidate of snapshot) {
        if (!isValidEntry(candidate) || isExpired(candidate.seenAt, now)) {
          continue;
        }
        entries.set(candidate.key, candidate.seenAt);
      }

      enforceCapacity();
    },
  };
}
