import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '../../../src/core/config/defaults.js';
import { CONFIG_SCHEMA_VERSION, configSchema } from '../../../src/core/config/schema.js';

/**
 * La configuration est la source de vérité de tout ce qui est paramétrable, et
 * l'exigence est stricte : aucune valeur métier ne doit être codée en dur dans le
 * code. Le schéma est donc autant un contrat qu'une documentation exécutable.
 *
 * Il joue également un rôle de sécurité : c'est lui qui filtre le fichier importé
 * par l'utilisateur depuis l'interface d'administration.
 */
describe('configSchema', () => {
  describe('valeurs par défaut', () => {
    it('accepte la configuration par défaut', () => {
      expect(() => configSchema.parse(DEFAULT_CONFIG)).not.toThrow();
    });

    it('applique le barème annoncé dans la documentation', () => {
      expect(DEFAULT_CONFIG.rewards.sub).toEqual({
        tier1: 180,
        tier2: 240,
        tier3: 300,
        prime: 180,
      });
    });

    it('démarre sur douze heures', () => {
      expect(DEFAULT_CONFIG.counter.initialSeconds).toBe(43_200);
    });

    it('n\'écoute que la boucle locale', () => {
      expect(DEFAULT_CONFIG.server.host).toBe('127.0.0.1');
    });

    it('désactive raid et follow tout en les gardant configurables', () => {
      expect(DEFAULT_CONFIG.rewards.raid.enabled).toBe(false);
      expect(DEFAULT_CONFIG.rewards.follow.enabled).toBe(false);
      expect(DEFAULT_CONFIG.rewards.raid.secondsPerViewer).toBeGreaterThan(0);
      expect(DEFAULT_CONFIG.rewards.follow.seconds).toBeGreaterThan(0);
    });

    it('porte le numéro de version courant du schéma', () => {
      expect(DEFAULT_CONFIG.schemaVersion).toBe(CONFIG_SCHEMA_VERSION);
    });

    it('diffuse le décompte une fois par seconde', () => {
      // L'overlay interpole localement : diffuser plus souvent n'améliorerait
      // pas la fluidité et réveillerait OBS pour rien.
      expect(DEFAULT_CONFIG.server.websocket.stateBroadcastIntervalMs).toBe(1_000);
    });

    it('plafonne la taille des messages WebSocket entrants', () => {
      expect(DEFAULT_CONFIG.server.websocket.maxMessageBytes).toBeGreaterThan(0);
      expect(DEFAULT_CONFIG.server.websocket.maxMessageBytes).toBeLessThanOrEqual(64 * 1_024);
    });

    it('plafonne la taille du corps des requêtes HTTP', () => {
      // Une configuration exportée puis réimportée est le plus gros corps
      // légitime : le plafond doit lui laisser de la marge, pas davantage.
      expect(DEFAULT_CONFIG.server.maxBodyBytes).toBeGreaterThan(0);
    });
  });

  describe('complétion des valeurs absentes', () => {
    it('complète un objet vide avec l\'intégralité des valeurs par défaut', () => {
      expect(configSchema.parse({})).toEqual(DEFAULT_CONFIG);
    });

    it('conserve les valeurs fournies et complète le reste', () => {
      const parsed = configSchema.parse({ counter: { initialSeconds: 3600 } });

      expect(parsed.counter.initialSeconds).toBe(3600);
      expect(parsed.counter.tickIntervalMs).toBe(DEFAULT_CONFIG.counter.tickIntervalMs);
      expect(parsed.rewards.sub.tier1).toBe(DEFAULT_CONFIG.rewards.sub.tier1);
    });
  });

  describe('refus des valeurs invalides', () => {
    it('refuse une récompense négative', () => {
      expect(() => configSchema.parse({ rewards: { sub: { tier1: -10 } } })).toThrow();
    });

    it('refuse un port hors de la plage autorisée', () => {
      expect(() => configSchema.parse({ server: { httpPort: 0 } })).toThrow();
      expect(() => configSchema.parse({ server: { httpPort: 70_000 } })).toThrow();
    });

    it('refuse une adresse d\'écoute autre que la boucle locale', () => {
      // Écouter sur 0.0.0.0 exposerait le panneau d'administration au réseau
      // local : c'est un défaut de sécurité, pas une préférence.
      expect(() => configSchema.parse({ server: { host: '0.0.0.0' } })).toThrow();
    });

    it('refuse un niveau de log inconnu', () => {
      expect(() => configSchema.parse({ logging: { level: 'verbeux' } })).toThrow();
    });

    it('refuse une durée maximale inférieure à la durée minimale', () => {
      expect(() =>
        configSchema.parse({
          counter: { minRemainingSeconds: 100, maxRemainingSeconds: 50 },
        }),
      ).toThrow();
    });

    it('refuse un mode de barème de bits inconnu', () => {
      expect(() => configSchema.parse({ rewards: { bits: { mode: 'aleatoire' } } })).toThrow();
    });

    it('refuse une couleur qui n\'est pas une notation hexadécimale', () => {
      expect(() => configSchema.parse({ overlay: { color: 'rouge vif' } })).toThrow();
    });

    it('refuse un intervalle de tick nul', () => {
      expect(() => configSchema.parse({ counter: { tickIntervalMs: 0 } })).toThrow();
    });
  });

  describe('protection contre les entrées hostiles', () => {
    it('écarte les clés inconnues plutôt que de les conserver', () => {
      const parsed = configSchema.parse({ counter: { initialSeconds: 60, inconnu: 'valeur' } });

      expect(parsed.counter).not.toHaveProperty('inconnu');
    });

    it('ne laisse pas une clé __proto__ polluer le prototype', () => {
      const hostile = JSON.parse('{"__proto__": {"pollue": true}}') as unknown;

      configSchema.parse(hostile);

      expect(({} as Record<string, unknown>)['pollue']).toBeUndefined();
    });

    it('refuse un barème de bits par paliers vide', () => {
      // Un tableau vide en mode paliers ne créditerait jamais rien : c'est une
      // configuration silencieusement inopérante, donc un piège pour le streamer.
      expect(() => configSchema.parse({ rewards: { bits: { mode: 'tiers', tiers: [] } } })).toThrow();
    });
  });
});

/**
 * Marqueur d'achèvement de l'assistant de première configuration.
 *
 * L'assistant dérive son étape de reprise de l'état réel — a-t-on un client ID,
 * un secret, un jeton, les portées ? — plutôt que d'un compteur d'étapes qui
 * dériverait de la réalité. Une seule chose ne se déduit de rien : le fait que
 * l'utilisateur soit allé au bout. La valeur de départ du compteur a toujours
 * une valeur par défaut, on ne peut donc pas distinguer « laissée telle quelle »
 * de « jamais vue ».
 *
 * D'où ce booléen, et lui seul. C'est la plus petite chose qu'il faille écrire
 * pour que l'assistant ne renvoie pas indéfiniment le streamer à l'étape du
 * barème une fois sa configuration terminée.
 */
describe('setup', () => {
  it("part de l'idée que l'assistant n'a jamais été mené à son terme", () => {
    expect(configSchema.parse({}).setup.completed).toBe(false);
  });

  it('retient que l’assistant a été mené à son terme', () => {
    expect(configSchema.parse({ setup: { completed: true } }).setup.completed).toBe(true);
  });

  it('écarte une valeur inconnue sans rejeter la configuration', () => {
    // Mode `strip` comme partout : un réglage supprimé depuis ne doit pas
    // empêcher l'application de démarrer après une mise à jour.
    const parsed = configSchema.parse({ setup: { completed: true, étape: 4 } });

    expect(parsed.setup).toStrictEqual({ completed: true });
  });
});
