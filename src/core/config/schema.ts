/**
 * Schéma de la configuration de ChronoCast.
 *
 * Source de vérité unique de tout ce qui est paramétrable. L'exigence est
 * stricte : aucune valeur métier n'est codée en dur dans le code, tout passe par
 * ici et devient donc modifiable depuis le panneau d'administration.
 *
 * Ce fichier remplit trois rôles à la fois :
 *
 *   1. **Contrat** — la forme exacte de la configuration, typée.
 *   2. **Documentation exécutable** — chaque réglage porte sa raison d'être.
 *   3. **Barrière de sécurité** — c'est ce schéma qui filtre le fichier importé
 *      par l'utilisateur depuis l'interface. Chaque objet est en mode `strip` :
 *      une clé inconnue est écartée silencieusement plutôt que propagée. Le
 *      résultat est un objet neuf ne contenant que des clés attendues, ce qui
 *      neutralise au passage toute tentative de pollution de prototype.
 *
 *      Écarter plutôt que rejeter est délibéré : refuser un fichier parce qu'il
 *      contient un réglage supprimé depuis empêcherait l'utilisateur de démarrer
 *      après une mise à jour.
 *
 * Chaque champ porte une valeur par défaut, si bien qu'un fichier partiel — celui
 * d'une version antérieure, par exemple — se complète automatiquement au lieu
 * d'être rejeté.
 */

import { z } from 'zod';

/**
 * Version du schéma.
 *
 * À incrémenter dès qu'une migration devient nécessaire, c'est-à-dire lorsque la
 * simple complétion par les valeurs par défaut ne suffit plus à convertir une
 * ancienne configuration.
 */
export const CONFIG_SCHEMA_VERSION = 1;

/** Notation hexadécimale, avec canal alpha optionnel : `#RGB`, `#RRGGBB`, `#RRGGBBAA`. */
const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, {
    message: 'couleur hexadécimale attendue, par exemple #FFCC00',
  });

/** Durée en secondes, positive ou nulle. */
const seconds = z.number().int().nonnegative();

/** Durée en secondes strictement positive : un délai nul n'aurait pas de sens. */
const positiveSeconds = z.number().int().positive();

const millisecondsAboveZero = z.number().int().positive();

/* -------------------------------------------------------------------------- */
/* Compteur                                                                    */
/* -------------------------------------------------------------------------- */

const counterSchema = z
  .object({
    /** Valeur de départ du compte à rebours. Douze heures par défaut. */
    initialSeconds: positiveSeconds.default(43_200),

    /**
     * Plancher du compteur. À zéro, le subathon s'achève lorsque le temps est
     * écoulé ; une valeur positive garantit un minimum au streamer.
     */
    minRemainingSeconds: seconds.default(0),

    /**
     * Plafond du compteur.
     *
     * Sans lui, une salve de gift subs pourrait porter le compteur à plusieurs
     * jours et enfermer le streamer dans un engagement intenable.
     */
    maxRemainingSeconds: positiveSeconds.default(86_400),

    /**
     * Période du décompte interne.
     *
     * L'overlay interpole de son côté : cette valeur ne conditionne pas la
     * fluidité de l'affichage, seulement la précision de l'état persisté.
     */
    tickIntervalMs: millisecondsAboveZero.default(250),

    /**
     * Période de sauvegarde de la décroissance naturelle.
     *
     * Les mutations — événement Twitch, action manuelle — sont persistées
     * immédiatement. Seule l'érosion du temps qui passe est écrite
     * périodiquement : en cas de crash on perd au pire cet intervalle, toujours
     * en faveur du streamer, alors qu'écrire à chaque tick userait le disque.
     */
    persistIntervalMs: millisecondsAboveZero.default(5_000),

    /** Reprend automatiquement le décompte au démarrage s'il était en cours. */
    resumeOnStartup: z.boolean().default(true),
  })
  .strip()
  .refine((value) => value.maxRemainingSeconds > value.minRemainingSeconds, {
    message: 'maxRemainingSeconds doit être strictement supérieur à minRemainingSeconds',
    path: ['maxRemainingSeconds'],
  });

/* -------------------------------------------------------------------------- */
/* Barème                                                                      */
/* -------------------------------------------------------------------------- */

/** Récompenses par palier d'abonnement, Prime compris. */
const tieredRewardSchema = z
  .object({
    tier1: seconds.default(180),
    tier2: seconds.default(240),
    tier3: seconds.default(300),
    /**
     * Les abonnements Prime ne se distinguent des Tier 1 que via
     * `channel.chat.notification` ; sans ce flux, cette valeur reste inutilisée
     * et le Tier 1 s'applique.
     */
    prime: seconds.default(180),
  })
  .strip();

const giftRewardSchema = z
  .object({
    tier1: seconds.default(180),
    tier2: seconds.default(240),
    tier3: seconds.default(300),

    /**
     * Plafond par événement.
     *
     * Un don de cent abonnements créditerait autrement cinq heures d'un coup.
     */
    maxPerEvent: positiveSeconds.default(3_600),
  })
  .strip();

const bitsTierSchema = z
  .object({
    /** Seuil à partir duquel ce palier s'applique. */
    minBits: z.number().int().positive(),
    seconds,
  })
  .strip();

const bitsRewardSchema = z
  .object({
    /**
     * `linear` crédite proportionnellement au nombre de bits ;
     * `tiers` applique un barème par seuils.
     */
    mode: z.enum(['linear', 'tiers']).default('linear'),

    linear: z
      .object({
        /** Nombre de bits formant une unité de récompense. */
        unit: z.number().int().positive().default(100),
        secondsPerUnit: seconds.default(60),
        /** En deçà de ce seuil, rien n'est crédité. */
        minBits: z.number().int().positive().default(1),
      })
      .strip()
      .default({}),

    tiers: z
      .array(bitsTierSchema)
      .default([
        { minBits: 100, seconds: 60 },
        { minBits: 500, seconds: 360 },
        { minBits: 1_000, seconds: 900 },
      ]),

    maxPerEvent: positiveSeconds.default(3_600),
  })
  .strip()
  .refine((value) => value.mode !== 'tiers' || value.tiers.length > 0, {
    message: 'le mode « tiers » exige au moins un palier',
    path: ['tiers'],
  });

const raidRewardSchema = z
  .object({
    /** Désactivé par défaut : un raid n'est pas un soutien financier. */
    enabled: z.boolean().default(false),
    secondsPerViewer: seconds.default(2),
    /** Ignore les raids trop petits, souvent automatisés. */
    minViewers: z.number().int().positive().default(5),
    maxSeconds: positiveSeconds.default(600),
  })
  .strip();

const followRewardSchema = z
  .object({
    /** Désactivé par défaut : trop exposé aux robots de follow. */
    enabled: z.boolean().default(false),
    seconds: seconds.default(10),
    /** Garde-fou anti-robots : plafond de récompenses par heure glissante. */
    maxPerHour: z.number().int().positive().default(60),
  })
  .strip();

const rewardsSchema = z
  .object({
    sub: tieredRewardSchema.default({}),
    resub: tieredRewardSchema.default({}),
    gift: giftRewardSchema.default({}),
    bits: bitsRewardSchema.default({}),
    raid: raidRewardSchema.default({}),
    follow: followRewardSchema.default({}),
  })
  .strip();

/* -------------------------------------------------------------------------- */
/* Twitch                                                                      */
/* -------------------------------------------------------------------------- */

const twitchSchema = z
  .object({
    /**
     * Identifiant public de l'application, saisi dans l'assistant.
     * Le secret associé n'est jamais stocké ici : il vit dans le SecretStore chiffré.
     */
    clientId: z.string().default(''),

    /** Chaîne surveillée, résolue automatiquement après authentification. */
    broadcasterUserId: z.string().default(''),
    broadcasterLogin: z.string().default(''),

    /**
     * Active `channel.chat.notification`, seul flux distinguant réellement Prime
     * de Tier 1. Exige les scopes `user:read:chat` et `user:bot`.
     */
    enableChatNotifications: z.boolean().default(true),

    /** Souscriptions optionnelles, alignées sur le barème. */
    enableRaid: z.boolean().default(false),
    enableFollow: z.boolean().default(false),

    /**
     * Point d'entrée EventSub.
     *
     * Surchargeable pour viser le serveur factice de la Twitch CLI et tester
     * subs, gifts et bits sans attendre de vrais événements.
     */
    eventsubUrl: z.string().url().default('wss://eventsub.wss.twitch.tv/ws'),
    helixBaseUrl: z.string().url().default('https://api.twitch.tv/helix'),
    idBaseUrl: z.string().url().default('https://id.twitch.tv'),

    /** Délai de keepalive négocié avec Twitch, en secondes (plage imposée : 10 à 600). */
    keepaliveTimeoutSeconds: z.number().int().min(10).max(600).default(30),
  })
  .strip();

/* -------------------------------------------------------------------------- */
/* Serveur local                                                               */
/* -------------------------------------------------------------------------- */

const serverSchema = z
  .object({
    httpPort: z.number().int().min(1).max(65_535).default(3_777),

    /**
     * Adresse d'écoute, restreinte à la boucle locale.
     *
     * Ce n'est pas une préférence : écouter sur `0.0.0.0` exposerait le panneau
     * d'administration — qui peut modifier le compteur — à tout le réseau local.
     */
    host: z.enum(['127.0.0.1', 'localhost']).default('127.0.0.1'),

    /**
     * Réglages du canal WebSocket.
     *
     * Il n'y a ni mode ni port ici, et c'est structurel : le socket est attaché
     * au serveur HTTP par son événement `upgrade`, si bien qu'un seul port est
     * à configurer et qu'il est déjà déclaré au-dessus. Les deux réglages qui
     * ont existé ici — `mode: 'shared' | 'separate'` et `port` — n'ont jamais
     * eu de lecteur : ils se réglaient sans rien produire. Ils ont été retirés
     * plutôt que documentés, un réglage inerte étant pire qu'un réglage absent.
     */
    websocket: z
      .object({
        /** Période des pings de vivacité. */
        heartbeatIntervalMs: millisecondsAboveZero.default(30_000),

        /**
         * Période de diffusion de l'état pendant le décompte.
         *
         * L'overlay interpole localement en `requestAnimationFrame` : diffuser
         * plus souvent n'améliorerait pas la fluidité et réveillerait la Browser
         * Source d'OBS pour rien. Les mutations — événement Twitch, action
         * manuelle — échappent à ce lissage et partent immédiatement.
         */
        stateBroadcastIntervalMs: millisecondsAboveZero.default(1_000),

        /**
         * Plafond d'un message entrant.
         *
         * Le canal n'accepte que `ping` et `subscribe`, dont la forme la plus
         * longue tient en quelques dizaines d'octets. Un kilooctet est déjà une
         * marge confortable, et borne ce qu'une page locale peut faire allouer.
         */
        maxMessageBytes: z.number().int().positive().max(65_536).default(4_096),
      })
      .strip()
      .default({}),

    /** Nombre de ports consécutifs essayés si le port choisi est déjà pris. */
    portFallbackAttempts: z.number().int().min(0).max(50).default(10),

    /**
     * Plafond du corps d'une requête HTTP.
     *
     * Le plus gros corps légitime est une configuration importée : quelques
     * kilooctets. Le plafond lui laisse de la marge sans permettre qu'un seul
     * POST sature la mémoire du processus et interrompe le subathon.
     */
    maxBodyBytes: z.number().int().positive().max(10_485_760).default(262_144),
  })
  .strip();

/* -------------------------------------------------------------------------- */
/* Overlay                                                                     */
/* -------------------------------------------------------------------------- */

const overlaySchema = z
  .object({
    /** Polices embarquées uniquement : l'application doit fonctionner hors ligne. */
    fontFamily: z.string().min(1).default('Inter, Segoe UI, system-ui, sans-serif'),
    fontSize: z.number().int().positive().default(96),
    fontWeight: z.number().int().min(100).max(900).default(700),
    letterSpacing: z.number().default(0),
    color: hexColor.default('#FFFFFF'),

    /** Affiche les jours dès que le compteur dépasse vingt-quatre heures. */
    showDays: z.boolean().default(true),
    /** Masque les heures tant que le compteur reste sous une heure. */
    hideEmptyHours: z.boolean().default(false),

    textAlign: z.enum(['left', 'center', 'right']).default('center'),

    shadow: z
      .object({
        enabled: z.boolean().default(true),
        color: hexColor.default('#000000CC'),
        blur: z.number().nonnegative().default(12),
        offsetX: z.number().default(0),
        offsetY: z.number().default(4),
      })
      .strip()
      .default({}),

    outline: z
      .object({
        enabled: z.boolean().default(false),
        color: hexColor.default('#000000'),
        width: z.number().nonnegative().default(2),
      })
      .strip()
      .default({}),

    glow: z
      .object({
        enabled: z.boolean().default(false),
        color: hexColor.default('#9146FF'),
        radius: z.number().nonnegative().default(20),
      })
      .strip()
      .default({}),

    /**
     * Dégradé à deux couleurs, et les endroits où il s'applique.
     *
     * Deux cibles indépendantes plutôt qu'un interrupteur unique : le dégradé
     * sur les chiffres et le dégradé sur le cadre sont deux envies distinctes,
     * et rien ne dit qu'on veuille les deux à la fois. Elles partagent en
     * revanche la **même** paire de couleurs et le même angle : les dédoubler
     * n'aurait servi qu'à donner l'occasion de les désaccorder.
     *
     * Éteint des deux côtés par défaut, comme tout ce qui change l'apparence
     * existante.
     */
    gradient: z
      .object({
        onText: z.boolean().default(false),
        onFrame: z.boolean().default(false),
        from: hexColor.default('#FF3D7F'),
        to: hexColor.default('#FF9A3D'),
        /** Sens du dégradé. 0° monte, 90° va vers la droite. */
        angleDeg: z.number().int().min(0).max(360).default(100),
      })
      .strip()
      .default({}),

    /**
     * Cadre entouré autour du compteur.
     *
     * À ne pas confondre avec `outline`, qui cerne les glyphes eux-mêmes. Le
     * cadre est une boîte, avec son trait, ses coins, sa marge intérieure et
     * son remplissage.
     *
     * L'opacité du remplissage est un réglage distinct de sa couleur parce que
     * `<input type="color">` ne sait pas exprimer la transparence : il rend
     * toujours six chiffres hexadécimaux. Les deux sont recomposés à
     * l'affichage.
     */
    frame: z
      .object({
        enabled: z.boolean().default(false),
        color: hexColor.default('#9146FF'),
        width: z.number().nonnegative().max(40).default(4),
        radius: z.number().nonnegative().max(200).default(18),
        paddingX: z.number().nonnegative().max(400).default(24),
        paddingY: z.number().nonnegative().max(400).default(12),
        fillColor: hexColor.default('#000000'),
        /*
         * Intérieur libre par défaut : un cadre est un trait, pas un pavé.
         * Un remplissage d'emblée visible masque la scène derrière le compteur
         * et fait passer le cadre pour un fond — c'est exactement l'effet qu'on
         * ne veut pas quand on en active un.
         */
        fillOpacity: z.number().min(0).max(1).default(0),
      })
      .strip()
      .default({}),

    animation: z
      .object({
        /** Effet déclenché à chaque ajout de temps. */
        onAdd: z.enum(['none', 'flash', 'pulse', 'shake']).default('pulse'),
        durationMs: millisecondsAboveZero.default(600),
      })
      .strip()
      .default({}),

    toast: z
      .object({
        /** Bulle flottante annonçant l'ajout et son auteur. */
        enabled: z.boolean().default(true),
        durationMs: millisecondsAboveZero.default(4_000),
        color: hexColor.default('#9146FF'),
        fontSize: z.number().int().positive().default(28),
      })
      .strip()
      .default({}),

    /** Charge `custom.css` depuis le répertoire de données, appliqué en dernier. */
    enableCustomCss: z.boolean().default(false),
  })
  .strip();

/* -------------------------------------------------------------------------- */
/* Journalisation et historique                                                */
/* -------------------------------------------------------------------------- */

const loggingSchema = z
  .object({
    level: z.enum(['debug', 'info', 'warning', 'error']).default('info'),
    /** Ancienneté maximale des fichiers de journal conservés. */
    retentionDays: z.number().int().min(1).max(365).default(14),
    /** Nombre d'enregistrements gardés en mémoire pour l'affichage immédiat. */
    ringBufferSize: z.number().int().min(50).max(10_000).default(500),
    /** Écriture sur la console : utile en développement, sans lecteur en production. */
    console: z.boolean().default(true),
  })
  .strip();

const historySchema = z
  .object({
    retentionDays: z.number().int().min(1).max(365).default(90),
    /** Taille de la fenêtre de déduplication des identifiants d'événement. */
    dedupCacheSize: z.number().int().min(100).max(100_000).default(5_000),
    /** Durée de vie d'un identifiant dans le cache de déduplication. */
    dedupTtlMs: millisecondsAboveZero.default(600_000),
    /**
     * Fenêtre de corrélation entre deux sources décrivant le même événement,
     * par exemple `channel.subscribe` et `channel.chat.notification`.
     */
    crossSourceWindowMs: millisecondsAboveZero.default(10_000),
  })
  .strip();

/* -------------------------------------------------------------------------- */
/* Configuration complète                                                      */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Assistant de première configuration                                         */
/* -------------------------------------------------------------------------- */

/**
 * État de l'assistant.
 *
 * Volontairement réduit à un booléen. L'assistant dérive son étape de reprise
 * de l'état réel — client ID présent, secret enregistré, jeton obtenu, portées
 * accordées — plutôt que d'un numéro d'étape qui finirait par mentir sur ce qui
 * est réellement configuré.
 *
 * Une seule chose ne se déduit de rien : le fait que l'utilisateur soit allé au
 * bout. La valeur de départ du compteur a toujours une valeur par défaut, on ne
 * peut donc pas distinguer « laissée telle quelle » de « jamais vue ». C'est ce
 * booléen, et rien d'autre, qui évite de renvoyer indéfiniment le streamer à
 * l'étape du barème.
 */
const setupSchema = z
  .object({
    completed: z.boolean().default(false),
  })
  .strip();

/* -------------------------------------------------------------------------- */
/* Application de bureau                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Comportements propres à la coquille Electron.
 *
 * Ces réglages n'ont d'effet que dans l'application Windows. C'est assumé, et
 * ce n'est pas le défaut qui a fait retirer `server.websocket.mode` : ils
 * agissent dans l'exécutable, seul artefact que l'utilisateur reçoit. Le point
 * d'entrée headless est un outil de développement, pas un livrable.
 *
 * Ce qui n'y figure pas compte autant. **Fermer la fenêtre replie toujours vers
 * le tray**, et cela ne se configure pas : le compteur doit survivre à un clic
 * sur la croix comme il survit à un crash. On ne rend pas réglable ce dont la
 * mauvaise valeur coûte le direct ; quitter reste possible, par le menu du
 * tray, qui est un geste délibéré.
 */
const appSchema = z
  .object({
    /** Lancement automatique à l'ouverture de la session Windows. */
    launchAtStartup: z.boolean().default(false),

    /**
     * Démarrage fenêtre masquée, dans le tray.
     *
     * Confort de qui lance au démarrage, et rien d'autre : au premier
     * lancement, une application qui ne montre rien passe pour une application
     * qui n'a pas démarré.
     */
    startMinimized: z.boolean().default(false),
  })
  .strip();

export const configSchema = z
  .object({
    /**
     * Version du schéma ayant produit ce fichier.
     *
     * Volontairement permissif : c'est une métadonnée de migration, pas un
     * réglage. La refuser reviendrait à jeter la configuration de l'utilisateur
     * précisément dans le cas où l'on cherche à la récupérer.
     */
    schemaVersion: z.number().int().nonnegative().default(CONFIG_SCHEMA_VERSION),
    counter: counterSchema.default({}),
    rewards: rewardsSchema.default({}),
    twitch: twitchSchema.default({}),
    server: serverSchema.default({}),
    overlay: overlaySchema.default({}),
    logging: loggingSchema.default({}),
    history: historySchema.default({}),
    setup: setupSchema.default({}),
    app: appSchema.default({}),
  })
  .strip();

/** Configuration validée et complétée. */
export type ChronoCastConfig = z.infer<typeof configSchema>;

/** Sous-arbres, exposés pour typer les services sans les coupler au tout. */
export type CounterConfig = ChronoCastConfig['counter'];
export type RewardsConfig = ChronoCastConfig['rewards'];
export type TwitchConfig = ChronoCastConfig['twitch'];
export type ServerConfig = ChronoCastConfig['server'];
export type OverlayConfig = ChronoCastConfig['overlay'];
export type LoggingConfig = ChronoCastConfig['logging'];
export type HistoryConfig = ChronoCastConfig['history'];
export type SetupConfig = ChronoCastConfig['setup'];
