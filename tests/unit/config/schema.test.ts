import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '../../../src/core/config/defaults.js';
import {
  CONFIG_SCHEMA_VERSION,
  configSchema,
  type ChronoCastConfig,
} from '../../../src/core/config/schema.js';

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

    it('ne crédite que les événements payants', () => {
      expect(Object.keys(DEFAULT_CONFIG.rewards).sort()).toEqual([
        'bits',
        'chatCommand',
        'gift',
        'happyHour',
        'happyHourRewards',
        'resub',
        'sub',
      ]);
    });

    it('laisse le Happy Hour éteint', () => {
      expect(DEFAULT_CONFIG.rewards.happyHour).toBe(false);
    });

    it('ne plafonne plus aucune récompense hors commande de chat', () => {
      expect(DEFAULT_CONFIG.rewards.gift).not.toHaveProperty('maxPerEvent');
      expect(DEFAULT_CONFIG.rewards.bits).not.toHaveProperty('maxPerEvent');
      expect(DEFAULT_CONFIG.counter).not.toHaveProperty('maxRemainingSeconds');
      expect(DEFAULT_CONFIG.rewards.chatCommand.maxSeconds).toBeGreaterThan(0);
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

    it('refuse un plancher négatif', () => {
      expect(() => configSchema.parse({ counter: { minRemainingSeconds: -1 } })).toThrow();
    });

    it('règle les bits par un taux, 100 bits pour 60 secondes par défaut', () => {
      expect(configSchema.parse({}).rewards.bits).toStrictEqual({ unit: 100, seconds: 60 });
    });

    it.each([
      { unit: 0 },
      { unit: -1 },
      { unit: 1.5 },
      { seconds: -1 },
      { seconds: 0.6 },
    ])('refuse le taux de bits %j', (bits) => {
      expect(() => configSchema.parse({ rewards: { bits } })).toThrow();
    });

    it('accepte un taux qui part de 1 bit, et un taux à zéro seconde', () => {
      expect(configSchema.parse({ rewards: { bits: { unit: 1, seconds: 0 } } }).rewards.bits).toStrictEqual({
        unit: 1,
        seconds: 0,
      });
    });

    // Ces clés ne sont pas refusées mais ignorées : c'est la conversion, en amont, qui les lit.
    it('écarte les clés des anciens modes de calcul', () => {
      const parsed = configSchema.parse({
        rewards: { bits: { mode: 'tiers', linear: { unit: 5 }, tiers: [] } },
      });

      expect(parsed.rewards.bits).toStrictEqual({ unit: 100, seconds: 60 });
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

    it('écarte les réglages hérités sans rejeter la configuration', () => {
      const parsed = configSchema.parse({
        schemaVersion: 1,
        counter: { initialSeconds: 60, maxRemainingSeconds: 86_400 },
        rewards: {
          gift: { tier1: 240, maxPerEvent: 3_600 },
          bits: { maxPerEvent: 3_600 },
          raid: { enabled: true, secondsPerViewer: 2 },
          follow: { enabled: true, seconds: 10 },
        },
        twitch: { enableRaid: true, enableFollow: true },
      });

      expect(parsed.counter.initialSeconds).toBe(60);
      expect(parsed.rewards.gift.tier1).toBe(240);
      expect(parsed.counter).not.toHaveProperty('maxRemainingSeconds');
      expect(parsed.rewards).not.toHaveProperty('raid');
      expect(parsed.rewards).not.toHaveProperty('follow');
      expect(parsed.twitch).not.toHaveProperty('enableRaid');
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

describe('goals', () => {
  it('retient une échelle nommée', () => {
    const parsed = configSchema.parse({
      goals: { tiers: [{ target: 50, label: 'Je me rase la tête' }] },
    });

    expect(parsed.goals.tiers).toEqual([{ target: 50, label: 'Je me rase la tête' }]);
  });

  it('accepte une échelle en désordre plutôt que de rejeter la configuration entière', () => {
    const parsed = configSchema.parse({
      goals: {
        tiers: [
          { target: 100, label: 'Cent' },
          { target: 50, label: 'Cinquante' },
        ],
      },
    });

    expect(parsed.goals.tiers).toHaveLength(2);
  });

  it('accepte deux paliers de même seuil : le tri et les doublons se règlent à la lecture', () => {
    expect(() =>
      configSchema.parse({
        goals: {
          tiers: [
            { target: 50, label: 'Premier' },
            { target: 50, label: 'Second' },
          ],
        },
      }),
    ).not.toThrow();
  });

  it('refuse un seuil nul ou négatif', () => {
    expect(() => configSchema.parse({ goals: { tiers: [{ target: 0, label: 'Rien' }] } })).toThrow();
    expect(() =>
      configSchema.parse({ goals: { tiers: [{ target: -5, label: 'Rien' }] } }),
    ).toThrow();
  });

  it('borne le libellé d’un palier à quarante caractères', () => {
    expect(() =>
      configSchema.parse({ goals: { tiers: [{ target: 50, label: 'x'.repeat(41) }] } }),
    ).toThrow();
  });

  it('écarte une clé inconnue dans un palier', () => {
    const parsed = configSchema.parse({
      goals: { tiers: [{ target: 50, label: 'Cinquante', bonusSeconds: 600 }] },
    });

    expect(parsed.goals.tiers[0]).toStrictEqual({ target: 50, label: 'Cinquante' });
  });

});

describe('apparence de la page Objectifs', () => {
  const appearance = (): ChronoCastConfig['goals']['overlay'] =>
    configSchema.parse({}).goals.overlay;

  it('part sur un texte lisible sur n’importe quelle scène', () => {
    const overlay = appearance();

    expect(overlay.fontSize).toBe(28);
    expect(overlay.fontWeight).toBe(700);
    expect(overlay.color).toBe('#FFFFFF');
    expect(overlay.textAlign).toBe('center');
  });

  it('affiche le compte par défaut : sans lui, la barre ne dit pas où elle en est', () => {
    expect(appearance().showCount).toBe(true);
  });

  it('dessine une barre pleine hauteur, arrondie et sur piste sombre', () => {
    const { bar } = appearance();

    expect(bar).toStrictEqual({
      width: 0,
      height: 48,
      radius: 24,
      fillColor: '#9146FF',
      trackColor: '#000000',
      trackOpacity: 0.5,
      borderWidth: 0,
      borderColor: '#9146FF',
    });
  });

  it('reprend l’ombre portée de l’overlay du compteur, allumée', () => {
    expect(appearance().shadow).toStrictEqual({
      enabled: true,
      color: '#000000CC',
      blur: 12,
      offsetX: 0,
      offsetY: 4,
    });
  });

  it('laisse contour et halo éteints', () => {
    expect(appearance().outline.enabled).toBe(false);
    expect(appearance().glow.enabled).toBe(false);
  });

  it('porte le dégradé sur la barre et non sur un cadre : la barre est la boîte', () => {
    const { gradient } = appearance();

    expect(gradient.onBar).toBe(false);
    expect(gradient.onText).toBe(false);
    expect(gradient).not.toHaveProperty('onFrame');
  });

  it('annonce un palier franchi cinq secondes, texte réglable', () => {
    expect(appearance().announce).toStrictEqual({
      enabled: true,
      durationMs: 5_000,
      color: '#FFCC00',
      text: 'Palier atteint',
    });
  });

  it('borne le texte de l’annonce à quarante caractères, comme celui de la commande de chat', () => {
    expect(() =>
      configSchema.parse({ goals: { overlay: { announce: { text: 'x'.repeat(41) } } } }),
    ).toThrow();
  });

  it('accepte un texte d’annonce vide : seul le libellé du palier s’affiche alors', () => {
    const parsed = configSchema.parse({ goals: { overlay: { announce: { text: '' } } } });

    expect(parsed.goals.overlay.announce.text).toBe('');
  });

  it('accepte une largeur de barre qui couvre une source 4K', () => {
    const parsed = configSchema.parse({ goals: { overlay: { bar: { width: 3840 } } } });

    expect(parsed.goals.overlay.bar.width).toBe(3840);
  });

  it.each([-1, 3841, 600.5])('refuse une largeur de barre de %d pixels', (width) => {
    expect(() => configSchema.parse({ goals: { overlay: { bar: { width } } } })).toThrow();
  });

  it('refuse une hauteur de barre négative', () => {
    expect(() => configSchema.parse({ goals: { overlay: { bar: { height: -1 } } } })).toThrow();
  });

  it('refuse une opacité de piste hors de l’intervalle', () => {
    expect(() =>
      configSchema.parse({ goals: { overlay: { bar: { trackOpacity: 1.5 } } } }),
    ).toThrow();
  });

  it('refuse une couleur qui n’est pas hexadécimale', () => {
    expect(() =>
      configSchema.parse({ goals: { overlay: { bar: { fillColor: 'purple' } } } }),
    ).toThrow();
  });

  it('n’a aucun cadre : la piste de la barre porte déjà fond, arrondi et bordure', () => {
    expect(appearance()).not.toHaveProperty('frame');
  });

  it('écarte une clé inconnue sans rejeter la configuration', () => {
    const parsed = configSchema.parse({
      goals: { overlay: { fontSize: 40, clignote: true } },
    });

    expect(parsed.goals.overlay.fontSize).toBe(40);
    expect(parsed.goals.overlay).not.toHaveProperty('clignote');
  });
});

describe('barème Happy Hour', () => {
  it('vaut par défaut le double du barème normal par défaut', () => {
    expect(configSchema.parse({}).rewards.happyHourRewards).toStrictEqual({
      sub: { tier1: 360, tier2: 480, tier3: 600, prime: 360 },
      resub: { tier1: 360, tier2: 480, tier3: 600, prime: 360 },
      gift: { tier1: 360, tier2: 480, tier3: 600 },
      bits: { unit: 100, seconds: 120 },
    });
  });

  it('complète un barème partiel', () => {
    const parsed = configSchema.parse({ rewards: { happyHourRewards: { gift: { tier1: 5 } } } });

    expect(parsed.rewards.happyHourRewards.gift).toStrictEqual({ tier1: 5, tier2: 480, tier3: 600 });
  });

  it('refuse des secondes négatives', () => {
    expect(() =>
      configSchema.parse({ rewards: { happyHourRewards: { sub: { tier1: -1 } } } }),
    ).toThrow();
  });
});

describe('barème de points de la barre d’objectif', () => {
  it('accepte un poids nul, qui retire un type d’événement de la barre', () => {
    expect(configSchema.parse({ goals: { points: { sub: { tier1: 0 } } } }).goals.points.sub.tier1).toBe(0);
  });

  it.each([-1, 1.5])('refuse un poids de %d', (tier1) => {
    expect(() => configSchema.parse({ goals: { points: { gift: { tier1 } } } })).toThrow();
  });

  // Un bit vaut un point, sans réglage : la clé d'une version antérieure est ignorée, pas refusée.
  it('ne porte plus de nombre de bits par point', () => {
    expect(configSchema.parse({ goals: { bitsPerSub: 500 } }).goals).not.toHaveProperty('bitsPerSub');
  });
});

describe('libellé d’unité de la barre d’objectif', () => {
  it('accepte un libellé vide : le compte s’affiche alors sans unité', () => {
    expect(configSchema.parse({ goals: { unitLabel: '' } }).goals.unitLabel).toBe('');
  });

  it('refuse un libellé plus long qu’un libellé de palier', () => {
    expect(() => configSchema.parse({ goals: { unitLabel: 'x'.repeat(41) } })).toThrow();
  });
});

describe('valeurs de départ de la barre d’objectif, comptée en points', () => {
  const goals = configSchema.parse({}).goals;

  it('cale les points des abonnements sur leur prix en bits', () => {
    expect(goals.points).toStrictEqual({
      sub: { tier1: 500, tier2: 1_000, tier3: 2_500, prime: 500 },
      resub: { tier1: 500, tier2: 1_000, tier3: 2_500, prime: 500 },
      gift: { tier1: 500, tier2: 1_000, tier3: 2_500 },
    });
  });

  it('nomme son unité « points »', () => {
    expect(goals.unitLabel).toBe('points');
  });

  it('porte d’office un premier palier à 1 000 points', () => {
    expect(goals.tiers).toStrictEqual([{ target: 1_000, label: 'Objectif' }]);
  });

  it('laisse supprimer ce palier : une échelle vide reste une échelle vide', () => {
    expect(configSchema.parse({ goals: { tiers: [] } }).goals.tiers).toStrictEqual([]);
  });

  it('passe le schéma en version 10, pour que le nombre de bits par point soit retiré du fichier', () => {
    expect(CONFIG_SCHEMA_VERSION).toBe(10);
  });
});
