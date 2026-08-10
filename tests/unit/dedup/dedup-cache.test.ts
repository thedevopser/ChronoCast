import { describe, expect, it } from 'vitest';

import { createDedupCache } from '../../../src/core/dedup/dedup-cache.js';

const NOW = 1_754_000_000_000;

describe('createDedupCache', () => {
  describe('admission', () => {
    it('accepte une clé jamais vue', () => {
      const cache = createDedupCache({ maxEntries: 100, ttlMs: 600_000 });

      expect(cache.admit('msg-1', NOW)).toBe(true);
    });

    it('refuse la même clé une seconde fois', () => {
      const cache = createDedupCache({ maxEntries: 100, ttlMs: 600_000 });
      cache.admit('msg-1', NOW);

      expect(cache.admit('msg-1', NOW)).toBe(false);
    });

    it('distingue deux clés différentes', () => {
      const cache = createDedupCache({ maxEntries: 100, ttlMs: 600_000 });
      cache.admit('msg-1', NOW);

      expect(cache.admit('msg-2', NOW)).toBe(true);
    });

    it('accepte de nouveau une clé dont la fenêtre a expiré', () => {
      const cache = createDedupCache({ maxEntries: 100, ttlMs: 1_000 });
      cache.admit('msg-1', NOW);

      expect(cache.admit('msg-1', NOW + 1_001)).toBe(true);
    });

    it('refuse encore une clé juste avant expiration', () => {
      const cache = createDedupCache({ maxEntries: 100, ttlMs: 1_000 });
      cache.admit('msg-1', NOW);

      expect(cache.admit('msg-1', NOW + 999)).toBe(false);
    });

    it('ne prolonge pas la fenêtre lors d\'une tentative refusée', () => {
      const cache = createDedupCache({ maxEntries: 100, ttlMs: 1_000 });
      cache.admit('msg-1', NOW);
      cache.admit('msg-1', NOW + 900);

      expect(cache.admit('msg-1', NOW + 1_001)).toBe(true);
    });
  });

  describe('consultation sans effet', () => {
    it('signale une clé connue sans rien modifier', () => {
      const cache = createDedupCache({ maxEntries: 100, ttlMs: 600_000 });
      cache.admit('msg-1', NOW);

      expect(cache.has('msg-1', NOW)).toBe(true);
      expect(cache.size()).toBe(1);
    });

    it('n\'enregistre pas la clé consultée', () => {
      const cache = createDedupCache({ maxEntries: 100, ttlMs: 600_000 });

      expect(cache.has('msg-1', NOW)).toBe(false);
      expect(cache.size()).toBe(0);
    });

    it('ignore une clé expirée', () => {
      const cache = createDedupCache({ maxEntries: 100, ttlMs: 1_000 });
      cache.admit('msg-1', NOW);

      expect(cache.has('msg-1', NOW + 2_000)).toBe(false);
    });
  });

  describe('limite de taille', () => {
    it('ne dépasse jamais la capacité annoncée', () => {
      const cache = createDedupCache({ maxEntries: 3, ttlMs: 600_000 });

      for (let index = 0; index < 10; index += 1) {
        cache.admit(`msg-${String(index)}`, NOW + index);
      }

      expect(cache.size()).toBe(3);
    });

    it('évince les entrées les plus anciennes en premier', () => {
      const cache = createDedupCache({ maxEntries: 2, ttlMs: 600_000 });
      cache.admit('ancien', NOW);
      cache.admit('milieu', NOW + 1);
      cache.admit('recent', NOW + 2);

      expect(cache.has('ancien', NOW + 3)).toBe(false);
      expect(cache.has('milieu', NOW + 3)).toBe(true);
      expect(cache.has('recent', NOW + 3)).toBe(true);
    });

    it('refuse une capacité inexploitable', () => {
      expect(() => createDedupCache({ maxEntries: 0, ttlMs: 1_000 })).toThrow(RangeError);
      expect(() => createDedupCache({ maxEntries: 10, ttlMs: 0 })).toThrow(RangeError);
    });
  });

  describe('purge', () => {
    it('retire les entrées expirées', () => {
      const cache = createDedupCache({ maxEntries: 100, ttlMs: 1_000 });
      cache.admit('msg-1', NOW);
      cache.admit('msg-2', NOW);

      cache.purge(NOW + 2_000);

      expect(cache.size()).toBe(0);
    });

    it('renvoie le nombre d\'entrées retirées', () => {
      const cache = createDedupCache({ maxEntries: 100, ttlMs: 1_000 });
      cache.admit('msg-1', NOW);
      cache.admit('msg-2', NOW + 5_000);

      expect(cache.purge(NOW + 2_000)).toBe(1);
    });

    it('conserve les entrées encore valides', () => {
      const cache = createDedupCache({ maxEntries: 100, ttlMs: 10_000 });
      cache.admit('msg-1', NOW);

      cache.purge(NOW + 1_000);

      expect(cache.has('msg-1', NOW + 1_000)).toBe(true);
    });
  });

  describe('persistance', () => {
    it('restitue son contenu sous une forme sérialisable', () => {
      const cache = createDedupCache({ maxEntries: 100, ttlMs: 600_000 });
      cache.admit('msg-1', NOW);

      const snapshot = cache.toSnapshot();

      expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    });

    it('retrouve son état après restauration', () => {
      const original = createDedupCache({ maxEntries: 100, ttlMs: 600_000 });
      original.admit('msg-1', NOW);

      const restored = createDedupCache({ maxEntries: 100, ttlMs: 600_000 });
      restored.loadSnapshot(original.toSnapshot(), NOW);

      expect(restored.admit('msg-1', NOW)).toBe(false);
    });

    it('écarte les entrées déjà expirées au chargement', () => {
      const original = createDedupCache({ maxEntries: 100, ttlMs: 1_000 });
      original.admit('msg-1', NOW);

      const restored = createDedupCache({ maxEntries: 100, ttlMs: 1_000 });
      restored.loadSnapshot(original.toSnapshot(), NOW + 5_000);

      expect(restored.size()).toBe(0);
    });

    it('ignore un instantané corrompu sans lever', () => {
      const cache = createDedupCache({ maxEntries: 100, ttlMs: 600_000 });

      expect(() => {
        cache.loadSnapshot('pas un tableau', NOW);
      }).not.toThrow();
      expect(cache.size()).toBe(0);
    });

    it('écarte les entrées mal formées et conserve les valides', () => {
      const cache = createDedupCache({ maxEntries: 100, ttlMs: 600_000 });

      cache.loadSnapshot(
        [
          { key: 'bon', seenAt: NOW },
          { key: 42, seenAt: NOW },
          { seenAt: NOW },
          null,
          { key: 'sans-date' },
        ],
        NOW,
      );

      expect(cache.size()).toBe(1);
      expect(cache.has('bon', NOW)).toBe(true);
    });

    it('respecte la capacité lors d\'une restauration surdimensionnée', () => {
      const cache = createDedupCache({ maxEntries: 2, ttlMs: 600_000 });

      cache.loadSnapshot(
        [
          { key: 'a', seenAt: NOW },
          { key: 'b', seenAt: NOW + 1 },
          { key: 'c', seenAt: NOW + 2 },
        ],
        NOW,
      );

      expect(cache.size()).toBe(2);
    });
  });
});
