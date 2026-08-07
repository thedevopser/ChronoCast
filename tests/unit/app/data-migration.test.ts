import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { migrateDataDirectory } from '../../../src/core/app/data-migration.js';

/**
 * Reprise des données d'une installation précédente.
 *
 * Le passage au Microsoft Store déplace le répertoire de données de
 * `%APPDATA%\ChronoCast` vers `%USERPROFILE%\ChronoCast`. Le motif n'est pas
 * cosmétique : **MSIX virtualise ce que l'application écrit dans `%APPDATA%`**,
 * et le conteneur ainsi constitué part avec la désinstallation. Y laisser les
 * données contredirait la décision qui veut qu'un subathon en cours survive à
 * une réinstallation — c'est précisément ce qu'on fait quand quelque chose ne
 * va pas.
 *
 * Sans reprise, chaque utilisateur déjà installé perdrait son compteur, sa
 * configuration et ses jetons, et devrait refaire l'OAuth Twitch. Ce module est
 * donc le seul endroit du projet qui puisse détruire quelque chose, d'où les
 * trois propriétés que ces tests tiennent :
 *
 *   - **il n'écrase jamais rien** ;
 *   - **il est rejouable**, une reprise interrompue se terminant au lancement
 *     suivant ;
 *   - **il n'empêche jamais l'application de démarrer**, quoi qu'il arrive au
 *     système de fichiers.
 */
describe('migrateDataDirectory', () => {
  let root: string;
  let source: string;
  let target: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'chronocast-migration-'));
    source = join(root, 'source');
    target = join(root, 'cible');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** Installation NSIS complète et plausible : configuration, compteur, jetons, historique, journaux. */
  async function seedLegacyInstallation(): Promise<void> {
    await mkdir(join(source, 'history'), { recursive: true });
    await mkdir(join(source, 'logs'), { recursive: true });

    await writeFile(join(source, 'counter.json'), '{"remainingMs":42000}', 'utf8');
    await writeFile(join(source, 'secrets.json'), '{"twitch":"chiffré"}', 'utf8');
    await writeFile(join(source, 'custom.css'), '.timer { color: red; }', 'utf8');
    await writeFile(join(source, 'history', 'events-2026-08-07.jsonl'), '{"type":"sub"}\n', 'utf8');
    await writeFile(join(source, 'logs', 'chronocast-2026-08-07.jsonl'), '{"level":"info"}\n', 'utf8');

    // Écrit en dernier, comme la reprise elle-même l'écrit en dernier.
    await writeFile(join(source, 'config.json'), '{"app":{"startMinimized":true}}', 'utf8');
  }

  describe('quand une installation précédente existe', () => {
    beforeEach(seedLegacyInstallation);

    it('reprend la configuration, le compteur, les jetons et les sous-répertoires', async () => {
      const outcome = await migrateDataDirectory({ source, target });

      expect(outcome.kind).toBe('migrated');

      await expect(readFile(join(target, 'config.json'), 'utf8')).resolves.toBe(
        '{"app":{"startMinimized":true}}',
      );
      await expect(readFile(join(target, 'counter.json'), 'utf8')).resolves.toBe(
        '{"remainingMs":42000}',
      );
      await expect(readFile(join(target, 'secrets.json'), 'utf8')).resolves.toBe(
        '{"twitch":"chiffré"}',
      );
      await expect(readFile(join(target, 'custom.css'), 'utf8')).resolves.toBe(
        '.timer { color: red; }',
      );
      await expect(
        readFile(join(target, 'history', 'events-2026-08-07.jsonl'), 'utf8'),
      ).resolves.toBe('{"type":"sub"}\n');
      await expect(readFile(join(target, 'logs', 'chronocast-2026-08-07.jsonl'), 'utf8')).resolves.toBe(
        '{"level":"info"}\n',
      );
    });

    it('rend compte de ce qu’elle a repris', async () => {
      const outcome = await migrateDataDirectory({ source, target });

      // Le décompte part au journal du panneau. Une reprise silencieuse est
      // indiscernable d'une installation neuve, et c'est exactement la
      // confusion qui ferait conclure à tort que la migration fonctionne.
      expect(outcome).toMatchObject({ kind: 'migrated', fileCount: 6 });
    });

    it('laisse l’ancienne installation intacte', async () => {
      await migrateDataDirectory({ source, target });

      // Une copie, jamais un déplacement. Si le passage au Store devait être
      // annulé, la version NSIS doit retrouver ses données là où elle les a
      // laissées.
      await expect(readFile(join(source, 'config.json'), 'utf8')).resolves.toBe(
        '{"app":{"startMinimized":true}}',
      );
    });

    it('écrit `config.json` en dernier, pour que sa présence vaille validation', async () => {
      await migrateDataDirectory({ source, target });

      const config = await stat(join(target, 'config.json'));
      const counter = await stat(join(target, 'counter.json'));

      // C'est ce qui rend une reprise interrompue rattrapable : tant que
      // `config.json` n'est pas là, la reprise n'a pas eu lieu et sera rejouée.
      expect(config.mtimeMs).toBeGreaterThanOrEqual(counter.mtimeMs);
    });

    it('termine une reprise interrompue sans écraser ce qui était déjà là', async () => {
      // Reprise coupée après le compteur, avant `config.json` — et le fichier
      // déjà copié a divergé depuis.
      await mkdir(target, { recursive: true });
      await writeFile(join(target, 'counter.json'), '{"remainingMs":1}', 'utf8');

      const outcome = await migrateDataDirectory({ source, target });

      expect(outcome.kind).toBe('migrated');
      await expect(readFile(join(target, 'config.json'), 'utf8')).resolves.toBe(
        '{"app":{"startMinimized":true}}',
      );
      // Ce qui existe déjà fait foi : on ne remplace jamais un fichier de la
      // cible par celui de la source.
      await expect(readFile(join(target, 'counter.json'), 'utf8')).resolves.toBe(
        '{"remainingMs":1}',
      );
    });

    it('ne reprend rien une seconde fois', async () => {
      await migrateDataDirectory({ source, target });
      await writeFile(join(target, 'config.json'), '{"app":{"startMinimized":false}}', 'utf8');

      const outcome = await migrateDataDirectory({ source, target });

      expect(outcome).toEqual({ kind: 'skipped', reason: 'cible-deja-configuree' });
      // Le réglage modifié depuis la reprise survit : c'est l'idempotence qui
      // compte ici, pas la copie.
      await expect(readFile(join(target, 'config.json'), 'utf8')).resolves.toBe(
        '{"app":{"startMinimized":false}}',
      );
    });
  });

  describe('quand il n’y a rien à reprendre', () => {
    it('ne fait rien si l’ancienne installation n’existe pas', async () => {
      const outcome = await migrateDataDirectory({ source, target });

      expect(outcome).toEqual({ kind: 'skipped', reason: 'aucune-installation-precedente' });
      await expect(stat(target)).rejects.toThrow();
    });

    it('ne fait rien si l’ancien répertoire existe sans configuration', async () => {
      // Un répertoire laissé par une désinstallation, ou créé par un essai
      // avorté : il ne décrit aucune installation configurée.
      await mkdir(join(source, 'logs'), { recursive: true });
      await writeFile(join(source, 'logs', 'chronocast.jsonl'), '{}\n', 'utf8');

      const outcome = await migrateDataDirectory({ source, target });

      expect(outcome).toEqual({ kind: 'skipped', reason: 'aucune-installation-precedente' });
    });

    it('ne fait rien quand la source et la cible sont le même répertoire', async () => {
      await seedLegacyInstallation();

      // Le cas du point d'entrée headless, et de tout poste où le déplacement
      // n'a pas lieu d'être. Recopier un répertoire sur lui-même n'a aucun sens
      // et pourrait le corrompre.
      const outcome = await migrateDataDirectory({ source, target: source });

      expect(outcome).toEqual({ kind: 'skipped', reason: 'source-et-cible-confondues' });
    });
  });

  describe('quand le système de fichiers refuse', () => {
    it('rend compte de l’échec sans jamais lever', async () => {
      await seedLegacyInstallation();

      // Une cible qui est un fichier, et non un répertoire : la création
      // échouera. Peu importe la cause exacte — ce qui compte est que
      // l'application démarre malgré tout, avec une configuration neuve, plutôt
      // que de refuser de se lancer pendant un direct.
      await writeFile(target, 'ceci n’est pas un répertoire', 'utf8');

      const outcome = await migrateDataDirectory({ source, target });

      expect(outcome.kind).toBe('failed');
      expect(outcome).toHaveProperty('cause');
    });
  });
});
