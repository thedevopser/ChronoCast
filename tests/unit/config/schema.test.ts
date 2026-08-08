import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '../../../src/core/config/defaults.js';
import { CONFIG_SCHEMA_VERSION, configSchema } from '../../../src/core/config/schema.js';

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

    it('laisse le cadre et le dégradé éteints, tout en les gardant réglables', () => {
      expect(DEFAULT_CONFIG.overlay.frame.enabled).toBe(false);
      expect(DEFAULT_CONFIG.overlay.gradient.onText).toBe(false);
      expect(DEFAULT_CONFIG.overlay.gradient.onFrame).toBe(false);
      expect(DEFAULT_CONFIG.overlay.frame.width).toBeGreaterThan(0);
      expect(DEFAULT_CONFIG.overlay.frame.radius).toBeGreaterThan(0);
      expect(DEFAULT_CONFIG.overlay.gradient.from).toMatch(/^#/);
      expect(DEFAULT_CONFIG.overlay.gradient.to).toMatch(/^#/);
    });

    it('laisse l’intérieur du cadre libre', () => {
      expect(DEFAULT_CONFIG.overlay.frame.fillOpacity).toBe(0);
    });

    it('porte le numéro de version courant du schéma', () => {
      expect(DEFAULT_CONFIG.schemaVersion).toBe(CONFIG_SCHEMA_VERSION);
    });

    it('diffuse le décompte une fois par seconde', () => {
      expect(DEFAULT_CONFIG.server.websocket.stateBroadcastIntervalMs).toBe(1_000);
    });

    it('plafonne la taille des messages WebSocket entrants', () => {
      expect(DEFAULT_CONFIG.server.websocket.maxMessageBytes).toBeGreaterThan(0);
      expect(DEFAULT_CONFIG.server.websocket.maxMessageBytes).toBeLessThanOrEqual(64 * 1_024);
    });

    it('n’annonce aucun mode ni port propre au WebSocket', () => {
      expect(DEFAULT_CONFIG.server.websocket).not.toHaveProperty('mode');
      expect(DEFAULT_CONFIG.server.websocket).not.toHaveProperty('port');
    });

    it('plafonne la taille du corps des requêtes HTTP', () => {
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

    it('refuse un angle de dégradé hors du tour complet', () => {
      expect(() => configSchema.parse({ overlay: { gradient: { angleDeg: 400 } } })).toThrow();
    });

    it('refuse une opacité de remplissage hors de [0, 1]', () => {
      expect(() => configSchema.parse({ overlay: { frame: { fillOpacity: 1.5 } } })).toThrow();
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

    it('accepte une configuration héritée portant l’ancien mode WebSocket', () => {
      const parsed = configSchema.parse({
        server: { websocket: { mode: 'separate', port: 3778, heartbeatIntervalMs: 15_000 } },
      });

      expect(parsed.server.websocket).not.toHaveProperty('mode');
      expect(parsed.server.websocket).not.toHaveProperty('port');
      expect(parsed.server.websocket.heartbeatIntervalMs).toBe(15_000);
    });

    it('refuse un barème de bits par paliers vide', () => {
      expect(() => configSchema.parse({ rewards: { bits: { mode: 'tiers', tiers: [] } } })).toThrow();
    });
  });
});

describe('app', () => {
  it('n’expose plus de réglage de lancement au démarrage', () => {
    expect(configSchema.parse({}).app).not.toHaveProperty('launchAtStartup');
  });

  it('ouvre sa fenêtre par défaut', () => {
    expect(configSchema.parse({}).app.startMinimized).toBe(false);
  });

  it('retient son réglage', () => {
    const parsed = configSchema.parse({ app: { startMinimized: true } });

    expect(parsed.app).toStrictEqual({ startMinimized: true });
  });

  it('n’expose aucun réglage de fermeture vers le tray', () => {
    expect(configSchema.parse({}).app).not.toHaveProperty('closeToTray');
  });
});

describe('rewards.chatCommand', () => {
  it('reste éteinte par défaut', () => {
    expect(configSchema.parse({}).twitch.enableChatCommands).toBe(false);
  });

  it('se nomme addtime, et le nom se règle', () => {
    expect(configSchema.parse({}).rewards.chatCommand.name).toBe('addtime');
    expect(
      configSchema.parse({ rewards: { chatCommand: { name: 'temps' } } }).rewards.chatCommand.name,
    ).toBe('temps');
  });

  it('plafonne une commande à une heure', () => {
    expect(configSchema.parse({}).rewards.chatCommand.maxSeconds).toBe(3_600);
  });

  it('annonce le temps ajouté sur l’overlay', () => {
    expect(configSchema.parse({}).rewards.chatCommand.overlayText).toBe('Temps ajouté');
  });

  it('accepte un libellé vide, qui vaut « pas de libellé »', () => {
    expect(
      configSchema.parse({ rewards: { chatCommand: { overlayText: '' } } }).rewards.chatCommand
        .overlayText,
    ).toBe('');
  });

  it('refuse un nom vide ou non alphanumérique', () => {
    expect(() => configSchema.parse({ rewards: { chatCommand: { name: '' } } })).toThrow();
    expect(() => configSchema.parse({ rewards: { chatCommand: { name: 'add time' } } })).toThrow();
    expect(() => configSchema.parse({ rewards: { chatCommand: { name: '!addtime' } } })).toThrow();
  });

  it('refuse un plafond nul ou négatif', () => {
    expect(() => configSchema.parse({ rewards: { chatCommand: { maxSeconds: 0 } } })).toThrow();
    expect(() => configSchema.parse({ rewards: { chatCommand: { maxSeconds: -60 } } })).toThrow();
  });

  it('borne la longueur du libellé', () => {
    expect(() =>
      configSchema.parse({ rewards: { chatCommand: { overlayText: 'x'.repeat(200) } } }),
    ).toThrow();
  });
});

describe('setup', () => {
  it("part de l'idée que l'assistant n'a jamais été mené à son terme", () => {
    expect(configSchema.parse({}).setup.completed).toBe(false);
  });

  it('retient que l’assistant a été mené à son terme', () => {
    expect(configSchema.parse({ setup: { completed: true } }).setup.completed).toBe(true);
  });

  it('écarte une valeur inconnue sans rejeter la configuration', () => {
    const parsed = configSchema.parse({ setup: { completed: true, étape: 4 } });

    expect(parsed.setup).toStrictEqual({ completed: true });
  });
});
