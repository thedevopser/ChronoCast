/**
 * Magasin de secrets de l'application Windows, adossé à `safeStorage`.
 *
 * `safeStorage` s'appuie sur DPAPI sous Windows : la clé est dérivée du compte
 * utilisateur, si bien qu'un autre compte de la même machine ne peut pas
 * déchiffrer les jetons. C'est la protection réelle annoncée depuis la Phase 1,
 * dont le magasin AES du point d'entrée headless n'est qu'un repli honnêtement
 * dégradé.
 *
 * **`safeStorage` est injecté et non importé d'`electron`.** Ce module reste
 * ainsi testable dans un conteneur Linux sans Chromium — mais surtout, la
 * logique qui entoure le chiffrement devient vérifiable : que faire quand le
 * chiffrement est indisponible, quand un blob ne se déchiffre pas, quand le
 * fichier a été tronqué par une coupure. Ce sont exactement les cas qu'on ne
 * veut pas découvrir sur le poste d'un utilisateur.
 *
 * Deux règles gouvernent tout le reste :
 *
 *   1. **Jamais de repli en clair.** Si le chiffrement est indisponible,
 *      l'écriture échoue. Écrire un jeton OAuth en clair donnerait l'illusion
 *      inverse de la vérité, et le modèle de menace l'interdit sans réserve.
 *   2. **La lecture ne lève jamais.** Un secret illisible vaut un secret absent :
 *      l'utilisateur retombe sur l'assistant de configuration, pas sur un écran
 *      de crash. Le cas est réel — un répertoire de données recopié depuis un
 *      autre compte Windows est indéchiffrable par construction.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { SecretStore } from '../core/app/ports.js';
import type { Logger } from '../core/logging/logger.js';

/** Fichier des secrets chiffrés, une entrée par clé. */
const SECRETS_FILE = 'secrets.json';

/**
 * Forme d'`electron.safeStorage` dont ce module a besoin, et rien de plus.
 *
 * La déclarer plutôt que d'importer le type d'Electron garde le module libre de
 * toute dépendance à la coquille, et rend explicite la surface employée.
 */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface SafeStorageSecretStoreOptions {
  /** Répertoire des données : le fichier des secrets y est écrit. */
  readonly directory: string;
  readonly safeStorage: SafeStorageLike;
  readonly logger: Logger;
}

export function createSafeStorageSecretStore(
  options: SafeStorageSecretStoreOptions,
): SecretStore {
  const { directory, safeStorage, logger } = options;
  const scoped = logger.child('secrets');

  const secretsPath = join(directory, SECRETS_FILE);

  /** Lit l'ensemble des secrets chiffrés. Un fichier illisible vaut un magasin vide. */
  async function readAll(): Promise<Record<string, unknown>> {
    try {
      const raw: unknown = JSON.parse(await readFile(secretsPath, 'utf8'));
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return {};
      }
      return raw as Record<string, unknown>;
    } catch {
      // Fichier absent, ou corrompu par une coupure en pleine écriture : on
      // repart d'un magasin vide plutôt que d'empêcher le démarrage. Au pire,
      // l'utilisateur se réauthentifie ; au mieux, il ne s'aperçoit de rien.
      return {};
    }
  }

  async function writeAll(entries: Record<string, unknown>): Promise<void> {
    await mkdir(directory, { recursive: true });
    // `0600` : lisible du seul propriétaire. Sans effet réel sous Windows, où
    // DPAPI fait le travail, mais le geste reste juste.
    await writeFile(secretsPath, JSON.stringify(entries), { encoding: 'utf8', mode: 0o600 });
  }

  return {
    isEncryptionAvailable(): boolean {
      // Interrogé à chaque appel, jamais mémorisé à la construction :
      // `safeStorage` n'est utilisable qu'après `app.whenReady()`, et la
      // composition de l'application le précède.
      return safeStorage.isEncryptionAvailable();
    },

    async read(key: string): Promise<string | null> {
      if (!safeStorage.isEncryptionAvailable()) {
        scoped.warning('chiffrement indisponible : aucun secret ne peut être relu');
        return null;
      }

      const entries = await readAll();
      const payload = entries[key];
      if (typeof payload !== 'string') {
        return null;
      }

      try {
        return safeStorage.decryptString(Buffer.from(payload, 'base64'));
      } catch {
        // DPAPI refuse un blob chiffré par un autre compte Windows. Le nom de
        // la clé suffit au diagnostic ; la valeur n'a rien à faire ici, et de
        // toute façon on ne l'a pas.
        scoped.warning('secret illisible : chiffré par un autre compte, ou altéré', { key });
        return null;
      }
    },

    async write(key: string, value: string): Promise<void> {
      if (!safeStorage.isEncryptionAvailable()) {
        // Aucun repli en clair, aucune exception à cette règle. L'appelant
        // remonte l'échec à l'utilisateur, qui saura que rien n'a été gardé —
        // c'est infiniment préférable à des jetons lisibles sur le disque.
        throw new Error(
          'chiffrement indisponible : le secret n’a pas été enregistré, aucune écriture en clair n’est faite',
        );
      }

      const entries = await readAll();
      entries[key] = safeStorage.encryptString(value).toString('base64');
      await writeAll(entries);
    },

    async delete(key: string): Promise<void> {
      // Volontairement sans contrôle de disponibilité du chiffrement : effacer
      // un secret devenu illisible est la seule porte de sortie de qui a
      // recopié son répertoire de données depuis un autre compte.
      const entries = await readAll();
      if (!(key in entries)) {
        return;
      }

      // Reconstruction plutôt que `delete` sur une clé calculée : la clé vient
      // de l'appelant, et retirer une propriété dynamique d'un objet hérité est
      // exactement le geste que la règle interdit.
      const remaining = Object.fromEntries(
        Object.entries(entries).filter(([name]) => name !== key),
      );
      await writeAll(remaining);
    },
  };
}
