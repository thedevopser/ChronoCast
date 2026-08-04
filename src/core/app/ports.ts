/**
 * Ports : la frontière entre le noyau et la plateforme.
 *
 * Ce fichier ne contient que des contrats, aucun comportement — il n'y a donc
 * rien à tester ici, c'est le vérificateur de types qui fait foi.
 *
 * Son existence est ce qui rend l'architecture testable. `src/core` ne connaît
 * ni Electron, ni le système de fichiers Windows, ni le trousseau du système
 * d'exploitation : il ne connaît que ces interfaces. La coquille Electron en
 * fournit les implémentations réelles (`src/main`), et le point d'entrée
 * headless en fournit des équivalents exécutables dans un conteneur Linux
 * (`src/headless`).
 *
 * Conséquence directe : l'intégralité de la logique métier se vérifie dans un
 * Node nu, sans Chromium ni serveur graphique.
 */

/**
 * Emplacement des données de l'utilisateur.
 *
 * Aucun chemin n'est jamais codé en dur dans le noyau. Sous Windows —
 * seule cible de la V1 — la racine est `%APPDATA%\ChronoCast`.
 */
export interface PathProvider {
  /** Racine des données : configuration, état du compteur, jetons. */
  readonly dataDirectory: string;

  /** Répertoire des journaux applicatifs. */
  readonly logsDirectory: string;

  /** Répertoire de l'historique des événements Twitch. */
  readonly historyDirectory: string;

  /** Répertoire des ressources web servies (overlay, administration). */
  readonly webRootDirectory: string;

  /** Compose un chemin sous {@link dataDirectory}, sans jamais en sortir. */
  resolveDataFile(...segments: string[]): string;
}

/**
 * Conservation chiffrée des secrets.
 *
 * L'implémentation Electron s'appuie sur `safeStorage`, adossé à DPAPI sous
 * Windows : le chiffrement est lié au compte utilisateur, si bien qu'un autre
 * compte de la même machine ne peut pas déchiffrer les jetons.
 */
export interface SecretStore {
  /**
   * Indique si un chiffrement réel est disponible.
   *
   * Lorsque ce n'est pas le cas, l'implémentation doit se replier sur une
   * solution dégradée **et** le signaler explicitement : mieux vaut un
   * utilisateur averti qu'une fausse impression de sécurité.
   */
  isEncryptionAvailable(): boolean;

  /** Lit un secret. Renvoie `null` s'il n'a jamais été écrit. */
  read(key: string): Promise<string | null>;

  /** Écrit un secret, en écrasant la valeur précédente. */
  write(key: string, value: string): Promise<void>;

  /** Efface un secret. Sans effet s'il est absent. */
  delete(key: string): Promise<void>;
}

/**
 * Source de temps.
 *
 * Deux horloges volontairement distinctes, parce qu'elles répondent à des
 * questions différentes :
 *
 *   - {@link now} donne l'instant courant, destiné aux horodatages. Elle peut
 *     reculer : changement d'heure, synchronisation NTP, réglage manuel.
 *   - {@link monotonicMs} ne recule jamais et sert exclusivement à mesurer des
 *     durées. C'est elle qui fait décompter le compteur, faute de quoi un
 *     passage à l'heure d'hiver offrirait une heure de subathon.
 */
export interface Clock {
  /** Millisecondes écoulées depuis l'époque Unix. */
  now(): number;

  /** Compteur monotone en millisecondes, sans origine significative. */
  monotonicMs(): number;
}

/**
 * Ouverture d'une URL dans le navigateur du système.
 *
 * Utilisée par le flux OAuth. L'implémentation doit refuser tout schéma autre
 * que `https:` — ouvrir une URL fournie par un tiers est une capacité sensible.
 */
export interface BrowserOpener {
  open(url: string): Promise<void>;
}

/**
 * Lancement de l'installeur d'une mise à jour déjà téléchargée et vérifiée.
 *
 * Le seul geste de la mise à jour que le noyau ne peut pas faire lui-même, et
 * il est irréductible : NSIS ne peut pas écraser un exécutable en cours
 * d'exécution. L'implémentation doit donc lancer un processus **détaché** — un
 * enfant ordinaire mourrait avec son parent — puis terminer l'application, et
 * la terminer **proprement**, faute de quoi le dernier état du compteur ne
 * serait pas sur le disque au moment où la nouvelle version le relira.
 *
 * Ce port est **facultatif**. Le point d'entrée headless n'en fournit aucun : il
 * n'est ni packagé ni installé, et proposer une mise à jour qu'il ne saurait
 * pas appliquer serait une promesse en l'air. Son absence désarme le service
 * entier plutôt que de lui faire afficher un bouton sans effet.
 */
export interface UpdateInstaller {
  /** Lance l'installeur désigné, puis termine l'application. */
  run(installerPath: string): Promise<void>;
}
