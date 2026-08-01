/**
 * Magasin de secrets de repli, hors d'Electron.
 *
 * **C'est un repli assumé, pas une solution.** Sous Windows — seule cible de la
 * V1 — les jetons Twitch sont protégés par `safeStorage`, adossé à DPAPI : la clé
 * est dérivée du compte utilisateur, si bien qu'un autre compte de la même
 * machine ne peut rien déchiffrer. C'est ce qu'apportera la coquille Electron.
 *
 * Ici, rien de tel n'existe. La clé vit à côté des données qu'elle protège :
 * quiconque lit le disque lit les jetons. Le chiffrement n'écarte qu'un regard
 * distrait, jamais un attaquant.
 *
 * D'où deux exigences qui comptent autant que la cryptographie elle-même :
 * `isEncryptionAvailable()` répond **faux**, et un avertissement explicite part
 * dans les journaux dès la première utilisation. Un utilisateur averti vaut mieux
 * qu'une fausse impression de sécurité — et l'inverse est la façon dont on finit
 * par stocker des secrets en clair sans que personne ne s'en aperçoive.
 *
 * Techniquement : AES-256-GCM, clé dérivée par scrypt. La phrase secrète vient de
 * `CHRONOCAST_SECRET_PASSPHRASE` si elle est définie — auquel cas rien de
 * déchiffrable ne subsiste sur le disque — sinon d'une clé aléatoire de 32 octets
 * engendrée une seule fois dans `secret.key`, en mode `0600`.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { SecretStore } from '../core/app/ports.js';
import type { Logger } from '../core/logging/logger.js';

/** Fichier des secrets chiffrés, une entrée par clé. */
const SECRETS_FILE = 'secrets.json';

/** Fichier de la clé engendrée localement, en l'absence de phrase secrète. */
const KEY_FILE = 'secret.key';

/** Variable d'environnement fournissant une phrase secrète, si l'utilisateur en veut une. */
const PASSPHRASE_VARIABLE = 'CHRONOCAST_SECRET_PASSPHRASE';

/** AES-256-GCM : chiffre et authentifie, ce qui rend une altération détectable. */
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export interface AesSecretStoreOptions {
  /** Répertoire des données : la clé et les secrets y sont écrits. */
  readonly directory: string;
  readonly logger: Logger;
}

/**
 * Sel de dérivation.
 *
 * Constant et versionné dans le code : il n'apporte rien face à un attaquant qui
 * lit déjà le fichier de clé, et le rendre aléatoire donnerait l'illusion d'une
 * protection que ce magasin n'offre pas.
 */
const SCRYPT_SALT = 'chronocast-headless-v1';

export function createAesSecretStore(options: AesSecretStoreOptions): SecretStore {
  const { directory, logger } = options;
  const scoped = logger.child('secrets');

  const secretsPath = join(directory, SECRETS_FILE);
  const keyPath = join(directory, KEY_FILE);

  let key: Buffer | null = null;
  let warned = false;

  /** N'avertit qu'une fois : répété à chaque lecture, l'avertissement serait ignoré. */
  function warnOnce(): void {
    if (warned) {
      return;
    }
    warned = true;
    scoped.warning(
      'magasin de secrets de repli : chiffrement local sans coffre-fort système. ' +
        'La clé est stockée à côté des données ; ce n’est pas équivalent à DPAPI. ' +
        'Utilisez l’application Windows pour une protection réelle.',
    );
  }

  /**
   * Charge la clé, en l'engendrant au premier appel.
   *
   * Synchrone à dessein : la clé est nécessaire avant toute opération, et un
   * chargement paresseux concurrent risquerait d'engendrer deux clés
   * différentes — dont l'une rendrait les secrets déjà écrits illisibles.
   */
  function loadKey(): Buffer {
    if (key !== null) {
      return key;
    }

    warnOnce();

    const passphrase = process.env[PASSPHRASE_VARIABLE];
    if (passphrase !== undefined && passphrase !== '') {
      // Rien de déchiffrable ne subsiste alors sur le disque : c'est le seul
      // mode de ce magasin qui protège réellement contre une lecture du disque.
      key = scryptSync(passphrase, SCRYPT_SALT, KEY_LENGTH);
      return key;
    }

    mkdirSync(directory, { recursive: true });

    let material: string;
    try {
      material = readFileSync(keyPath, 'utf8');
    } catch {
      material = randomBytes(KEY_LENGTH).toString('hex');
      // `0600` : lisible du seul propriétaire. Sans effet réel sous Windows, mais
      // le point d'entrée headless sert d'abord au développement sous Linux.
      writeFileSync(keyPath, material, { encoding: 'utf8', mode: 0o600 });
    }

    key = scryptSync(material, SCRYPT_SALT, KEY_LENGTH);
    return key;
  }

  /** Lit l'ensemble des secrets chiffrés. Un fichier illisible vaut un magasin vide. */
  async function readAll(): Promise<Record<string, string>> {
    try {
      const raw: unknown = JSON.parse(await readFile(secretsPath, 'utf8'));
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return {};
      }
      return raw as Record<string, string>;
    } catch {
      // Fichier absent ou corrompu par une coupure : on repart d'un magasin
      // vide plutôt que d'empêcher le démarrage. Au pire, l'utilisateur se
      // réauthentifie ; au mieux, il ne s'aperçoit de rien.
      return {};
    }
  }

  async function writeAll(entries: Record<string, string>): Promise<void> {
    mkdirSync(directory, { recursive: true });
    await writeFile(secretsPath, JSON.stringify(entries), { encoding: 'utf8', mode: 0o600 });
  }

  function encrypt(value: string): string {
    // Un vecteur d'initialisation neuf à chaque écriture : le réutiliser
    // rendrait deux valeurs identiques reconnaissables et, avec GCM, casserait
    // l'authentification elle-même.
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, loadKey(), iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);

    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
  }

  function decrypt(payload: string): string | null {
    try {
      const raw = Buffer.from(payload, 'base64');
      if (raw.byteLength <= IV_LENGTH + AUTH_TAG_LENGTH) {
        return null;
      }

      const iv = raw.subarray(0, IV_LENGTH);
      const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
      const encrypted = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

      const decipher = createDecipheriv(ALGORITHM, loadKey(), iv);
      decipher.setAuthTag(authTag);

      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    } catch {
      // `final()` lève lorsque l'authentification échoue : la valeur a été
      // altérée, ou la clé a changé. Dans les deux cas il n'y a rien à rendre.
      scoped.warning('secret illisible : contenu altéré ou clé différente');
      return null;
    }
  }

  return {
    isEncryptionAvailable(): boolean {
      // Volontairement faux. Ce magasin chiffre, mais ne protège pas : répondre
      // vrai laisserait croire à une garantie qu'il n'apporte pas.
      return false;
    },

    async read(key_: string): Promise<string | null> {
      const entries = await readAll();
      const payload = entries[key_];
      return payload === undefined ? null : decrypt(payload);
    },

    async write(key_: string, value: string): Promise<void> {
      const entries = await readAll();
      entries[key_] = encrypt(value);
      await writeAll(entries);
    },

    async delete(key_: string): Promise<void> {
      const entries = await readAll();
      if (!(key_ in entries)) {
        return;
      }

      // Reconstruction plutôt que `delete` sur une clé calculée : la clé vient
      // de l'appelant, et retirer une propriété dynamique d'un objet hérité est
      // exactement le geste que la règle interdit.
      const remaining = Object.fromEntries(
        Object.entries(entries).filter(([name]) => name !== key_),
      );
      await writeAll(remaining);
    },
  };
}
