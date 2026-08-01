/**
 * Magasin JSON à écriture atomique.
 *
 * C'est ce module qui porte la promesse centrale de ChronoCast : « le compteur
 * survit à un crash ». Le scénario redouté est la coupure de courant en pleine
 * écriture — un `writeFile` direct laisse alors un fichier tronqué, donc un JSON
 * invalide, donc un compteur perdu au pire moment d'un subathon.
 *
 * La parade tient en trois temps :
 *
 *   1. la sérialisation est écrite dans un fichier temporaire, puis `fsync` la
 *      pousse réellement sur le disque et non dans le cache du système ;
 *   2. la version courante est recopiée en `.bak` avant d'être remplacée ;
 *   3. `rename` substitue le temporaire au fichier principal — une opération
 *      atomique, aussi bien sur NTFS que sur les systèmes POSIX.
 *
 * À la lecture, toute anomalie déclenche un repli en cascade : fichier principal,
 * puis fichier de secours, puis valeurs par défaut. Une lecture ne lève jamais :
 * démarrer avec un compteur remis à zéro reste préférable à un refus de démarrer.
 */

import { constants } from 'node:fs';
import { copyFile, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { Logger } from '../logging/logger.js';

/** Suffixe du fichier conservant la version précédente. */
const BACKUP_SUFFIX = '.bak';

/** Suffixe du fichier temporaire d'écriture. */
const TEMPORARY_SUFFIX = '.tmp';

/** Indentation de la sérialisation : les fichiers doivent rester lisibles à la main. */
const JSON_INDENTATION = 2;

/** Échec de persistance. Le compteur doit pouvoir en informer l'utilisateur. */
export class StoreWriteError extends Error {
  public override readonly name = 'StoreWriteError';

  public constructor(
    public readonly filePath: string,
    cause: unknown,
  ) {
    super(`écriture impossible dans ${filePath}`, { cause });
  }
}

export interface AtomicJsonStore<T> {
  readonly filePath: string;

  /**
   * Lit la valeur persistée.
   *
   * Ne lève jamais : en cas d'anomalie, se rabat sur le fichier de secours puis
   * sur les valeurs par défaut, en journalisant ce qui s'est produit.
   */
  read(): Promise<T>;

  /**
   * Écrit la valeur de façon atomique et durable.
   *
   * Lève {@link StoreWriteError} si la persistance échoue : l'appelant doit
   * savoir que son état n'a pas été sauvegardé.
   */
  write(value: T): Promise<void>;
}

export interface AtomicJsonStoreOptions<T> {
  readonly filePath: string;

  /**
   * Valide et convertit une valeur brute issue du JSON.
   * Doit lever si la forme est invalide — c'est ce qui déclenche le repli.
   */
  readonly parse: (raw: unknown) => T;

  /** Valeur retenue lorsque rien d'exploitable n'a pu être lu. */
  readonly createDefault: () => T;

  readonly logger: Logger;
}

/** Vrai si l'erreur signale un fichier absent. */
function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

/**
 * Force l'écriture réelle du contenu d'un répertoire sur le disque.
 *
 * Sans cela, `rename` peut être encore en cache lors d'une coupure et le fichier
 * principal réapparaître à l'ancienne version. L'opération n'est pas supportée
 * partout — notamment sur certains systèmes de fichiers Windows — et son échec
 * est donc sans conséquence : l'atomicité du `rename` reste acquise.
 */
async function syncDirectory(directoryPath: string): Promise<void> {
  try {
    const handle = await open(directoryPath, constants.O_RDONLY);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Ignoré volontairement : optimisation de durabilité, pas une garantie requise.
  }
}

export function createAtomicJsonStore<T>(options: AtomicJsonStoreOptions<T>): AtomicJsonStore<T> {
  const { filePath, parse, createDefault, logger } = options;
  const backupPath = `${filePath}${BACKUP_SUFFIX}`;
  const temporaryPath = `${filePath}${TEMPORARY_SUFFIX}`;
  const directoryPath = dirname(filePath);

  /**
   * File d'attente des écritures.
   *
   * Deux écritures concurrentes viseraient le même fichier temporaire et
   * pourraient entrelacer leurs `rename`. Les enchaîner garantit qu'une écriture
   * est toujours complète avant que la suivante ne commence.
   */
  let writeQueue: Promise<void> = Promise.resolve();

  /** Tente de lire et valider un fichier. Renvoie `undefined` s'il est inexploitable. */
  async function readCandidate(
    candidatePath: string,
  ): Promise<{ readonly value: T } | { readonly failure: unknown } | undefined> {
    let raw: string;
    try {
      raw = await readFile(candidatePath, 'utf8');
    } catch (error) {
      if (isFileNotFound(error)) {
        return undefined;
      }
      return { failure: error };
    }

    try {
      return { value: parse(JSON.parse(raw)) };
    } catch (error) {
      return { failure: error };
    }
  }

  /**
   * Met de côté un fichier illisible avant de repartir des valeurs par défaut.
   *
   * Sans cela, la prochaine écriture l'écraserait et toute chance de
   * récupération manuelle disparaîtrait avec lui.
   */
  async function quarantine(candidatePath: string): Promise<void> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    try {
      await copyFile(candidatePath, `${candidatePath}.corrupt-${stamp}`);
    } catch (error) {
      logger.warning('mise en quarantaine impossible', {
        path: candidatePath,
        cause: error,
      });
    }
  }

  async function performWrite(value: T): Promise<void> {
    try {
      await mkdir(directoryPath, { recursive: true });

      const serialized = `${JSON.stringify(value, null, JSON_INDENTATION)}\n`;

      // Écriture puis `fsync` : sans synchronisation explicite, le contenu peut
      // n'exister que dans le cache du système au moment du `rename`.
      const handle = await open(temporaryPath, 'w');
      try {
        await handle.writeFile(serialized, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }

      // Sauvegarde de la version courante avant de la remplacer. Une copie et non
      // un `rename` : le fichier principal ne doit à aucun instant disparaître.
      try {
        await copyFile(filePath, backupPath);
      } catch (error) {
        if (!isFileNotFound(error)) {
          // Ne pas pouvoir sauvegarder l'ancienne version n'est pas une raison de
          // perdre la nouvelle : on poursuit en le signalant.
          logger.warning('sauvegarde de la version précédente impossible', {
            path: backupPath,
            cause: error,
          });
        }
      }

      await rename(temporaryPath, filePath);
      await syncDirectory(directoryPath);
    } catch (error) {
      // Le temporaire ne doit jamais rester : il serait pris pour un état valide
      // par une inspection manuelle et polluerait le répertoire de données.
      try {
        await unlink(temporaryPath);
      } catch {
        // Absent ou déjà nettoyé : sans importance.
      }

      logger.error('échec de persistance', { path: filePath, cause: error });
      throw new StoreWriteError(filePath, error);
    }
  }

  return {
    filePath,

    async read(): Promise<T> {
      const primary = await readCandidate(filePath);

      if (primary !== undefined && 'value' in primary) {
        return primary.value;
      }

      if (primary === undefined) {
        // Aucun fichier principal : premier démarrage, ou données effacées.
        const backup = await readCandidate(backupPath);
        if (backup !== undefined && 'value' in backup) {
          logger.warning('fichier principal absent, restauration depuis la sauvegarde', {
            path: filePath,
          });
          return backup.value;
        }

        logger.info('aucun état persisté, utilisation des valeurs par défaut', {
          path: filePath,
        });
        return createDefault();
      }

      logger.warning('fichier principal illisible, tentative de restauration', {
        path: filePath,
        cause: primary.failure,
      });

      const backup = await readCandidate(backupPath);
      if (backup !== undefined && 'value' in backup) {
        return backup.value;
      }

      await quarantine(filePath);
      logger.error('aucune version exploitable, retour aux valeurs par défaut', {
        path: filePath,
        backupPath,
      });
      return createDefault();
    },

    async write(value: T): Promise<void> {
      // Chaînage : chaque écriture attend la précédente, y compris si celle-ci a
      // échoué — d'où le `catch` qui neutralise le rejet pour la file elle-même,
      // l'erreur restant propagée à son propre appelant.
      const queued = writeQueue.then(
        () => performWrite(value),
        () => performWrite(value),
      );
      writeQueue = queued.catch(() => undefined);
      return queued;
    },
  };
}
