/**
 * Reprise des données d'une installation précédente.
 *
 * Le passage au Microsoft Store déplace le répertoire de données de
 * `%APPDATA%\ChronoCast` vers `%USERPROFILE%\ChronoCast`, et ce déplacement
 * n'est pas cosmétique : **MSIX virtualise ce qu'une application packagée écrit
 * dans `%APPDATA%`**, dans un conteneur qui part avec la désinstallation. Y
 * laisser le compteur, la configuration et les jetons contredirait la décision
 * qui veut qu'un subathon en cours survive à une réinstallation — c'est
 * précisément ce qu'on fait quand quelque chose ne va pas.
 *
 * Ce module est le seul du projet qui puisse détruire quelque chose. Trois
 * propriétés l'en empêchent, et elles sont tenues par des tests :
 *
 *   - **il copie, il ne déplace pas**, et n'écrase jamais un fichier existant ;
 *   - **il est rejouable** : `config.json` est écrit en dernier, si bien qu'une
 *     reprise interrompue n'a pas eu lieu et se rejoue au lancement suivant ;
 *   - **il ne lève jamais**. Un système de fichiers récalcitrant rend un échec
 *     décrit, pas une exception : refuser de démarrer pendant un direct coûte
 *     plus cher que démarrer sur une configuration neuve.
 *
 * Comme tout ce qui vit sous `src/core`, il n'importe pas `electron` : la
 * coquille lui passe deux chemins, il ne sait rien d'autre.
 */

import { constants } from 'node:fs';
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/**
 * Fichier de configuration, et **marqueur d'une installation configurée**.
 *
 * Il porte deux rôles, et c'est délibéré. Se fier à la vacuité du répertoire
 * cible ne marcherait pas : un fichier de journal écrit à la milliseconde
 * précédente suffirait à faire conclure qu'il y a déjà une installation. La
 * présence de `config.json`, elle, dit exactement ce qu'on veut savoir — cette
 * installation a-t-elle déjà tourné.
 *
 * `application.ts` lit le même nom depuis ici : les désaccorder ferait chercher
 * la reprise sur un fichier que l'application n'écrit pas, c'est-à-dire ne
 * reprendrait plus jamais rien, sans la moindre erreur.
 */
export const CONFIG_FILE = 'config.json';

/** Motif pour lequel aucune reprise n'a eu lieu. */
export type DataMigrationSkipReason =
  /** Aucune installation configurée à l'ancien emplacement. Cas du premier lancement. */
  | 'aucune-installation-precedente'
  /** La cible a déjà tourné : ses données font foi, et rien ne les remplace. */
  | 'cible-deja-configuree'
  /** Rien à déplacer — le point d'entrée headless, ou un poste jamais migré. */
  | 'source-et-cible-confondues';

/** Ce qu'il est advenu de la reprise, tel que le journal du panneau le rapporte. */
export type DataMigrationOutcome =
  | { readonly kind: 'skipped'; readonly reason: DataMigrationSkipReason }
  | { readonly kind: 'migrated'; readonly fileCount: number }
  | { readonly kind: 'failed'; readonly cause: unknown };

export interface DataMigrationOptions {
  /** Ancien répertoire de données — `%APPDATA%\ChronoCast` sous Windows. */
  readonly source: string;
  /** Nouveau répertoire, hors du conteneur MSIX. */
  readonly target: string;
}

/** Vrai si le chemin désigne un fichier lisible. Toute erreur vaut « absent ». */
async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    // `ENOENT` évidemment, mais aussi `ENOTDIR` quand un parent est un fichier :
    // dans les deux cas, il n'y a pas de fichier là, et c'est tout ce qui
    // importe ici.
    return false;
  }
}

/**
 * Copie récursivement le contenu d'un répertoire, sans jamais écraser.
 *
 * `COPYFILE_EXCL` fait porter l'exclusion au système de fichiers plutôt qu'à un
 * test d'existence suivi d'une écriture : entre les deux, la cible aurait pu
 * apparaître. Le cas est théorique ici, mais le coût de le traiter juste est
 * nul.
 *
 * @returns Le nombre de fichiers effectivement copiés.
 */
async function copyDirectoryContents(
  source: string,
  target: string,
  skip: ReadonlySet<string>,
): Promise<number> {
  await mkdir(target, { recursive: true });

  const entries = await readdir(source, { withFileTypes: true });
  let copied = 0;

  for (const entry of entries) {
    if (skip.has(entry.name)) {
      continue;
    }

    const from = join(source, entry.name);
    const to = join(target, entry.name);

    if (entry.isDirectory()) {
      copied += await copyDirectoryContents(from, to, new Set());
      continue;
    }

    // Ni lien symbolique, ni socket, ni tube nommé. Rien de tout cela n'a été
    // écrit par ChronoCast, et suivre un lien permettrait de faire copier —
    // donc de faire lire — un fichier hors du répertoire de données.
    if (!entry.isFile()) {
      continue;
    }

    try {
      await copyFile(from, to, constants.COPYFILE_EXCL);
      copied += 1;
    } catch (error) {
      // Le fichier existe déjà à destination : c'est le cas nominal d'une
      // reprise interrompue puis rejouée, pas un incident. Ce qui est en place
      // fait foi.
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
  }

  return copied;
}

/**
 * Reprend les données de `source` vers `target`, si et seulement s'il y a lieu.
 *
 * Appelée au tout début du démarrage, avant que quoi que ce soit n'ait lu la
 * configuration ou écrit un journal dans la cible.
 */
export async function migrateDataDirectory(
  options: DataMigrationOptions,
): Promise<DataMigrationOutcome> {
  const source = resolve(options.source);
  const target = resolve(options.target);

  if (source === target) {
    return { kind: 'skipped', reason: 'source-et-cible-confondues' };
  }

  try {
    if (await fileExists(join(target, CONFIG_FILE))) {
      return { kind: 'skipped', reason: 'cible-deja-configuree' };
    }

    if (!(await fileExists(join(source, CONFIG_FILE)))) {
      return { kind: 'skipped', reason: 'aucune-installation-precedente' };
    }

    const copied = await copyDirectoryContents(source, target, new Set([CONFIG_FILE]));

    // En dernier, et seul de son espèce : tant qu'il n'est pas là, la reprise
    // n'a pas eu lieu et le lancement suivant la rejouera. C'est ce qui rend
    // une coupure de courant en cours de copie sans conséquence.
    await copyFile(join(source, CONFIG_FILE), join(target, CONFIG_FILE), constants.COPYFILE_EXCL);

    return { kind: 'migrated', fileCount: copied + 1 };
  } catch (error) {
    // Jamais de propagation. L'application démarre sur une configuration neuve,
    // et le journal dit pourquoi — ce qui est réparable, là où un démarrage
    // refusé pendant un direct ne l'est pas.
    return { kind: 'failed', cause: error };
  }
}
