export interface DedupEntry {
  readonly key: string;
  readonly seenAt: number;
}

export interface DedupCache {
  admit(key: string, now: number): boolean;

  has(key: string, now: number): boolean;

  purge(now: number): number;

  size(): number;

  toSnapshot(): DedupEntry[];

  loadSnapshot(snapshot: unknown, now: number): void;
}

export interface DedupCacheOptions {
  readonly maxEntries: number;

  readonly ttlMs: number;
}

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

  const entries = new Map<string, number>();

  function isExpired(seenAt: number, now: number): boolean {
    return now - seenAt >= ttlMs;
  }

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
