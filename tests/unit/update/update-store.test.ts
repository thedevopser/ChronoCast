import { mkdtemp, readFile, rm, writeFile, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFsUpdateStore, UPDATES_DIRECTORY } from '../../../src/core/update/update-store.js';

/**
 * Le répertoire des mises à jour, sur un vrai système de fichiers.
 *
 * Ce module est court, mais c'est le seul du lot qui écrit réellement, et ce
 * qu'il écrit est un exécutable. Deux choses valent d'être tenues : qu'il crée
 * son répertoire plutôt que d'échouer sur une installation neuve, et qu'il
 * fasse le ménage — un installeur oublié pèse une centaine de mégaoctets dans
 * le profil de l'utilisateur.
 */
describe('createFsUpdateStore', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'chronocast-updates-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const store = () =>
    createFsUpdateStore({
      resolveDataFile: (...segments: string[]) => join(root, ...segments),
    });

  it('crée le répertoire au premier enregistrement', async () => {
    // Sur une installation neuve, `%APPDATA%\ChronoCast\updates` n'existe pas.
    const path = await store().save('ChronoCast-Setup-0.5.1.exe', new TextEncoder().encode('MZ'));

    expect(path).toBe(join(root, UPDATES_DIRECTORY, 'ChronoCast-Setup-0.5.1.exe'));
    await expect(readFile(path, 'utf8')).resolves.toBe('MZ');
  });

  it('rend un chemin absolu', async () => {
    // Le port d'installation refuse tout chemin relatif : lui en donner un
    // ferait échouer l'installation au dernier moment.
    const path = await store().save('ChronoCast-Setup-0.5.1.exe', new Uint8Array([0x4d]));

    expect(path.startsWith(root)).toBe(true);
  });

  it('écrase un téléchargement précédent portant le même nom', async () => {
    const s = store();
    await s.save('ChronoCast-Setup-0.5.1.exe', new TextEncoder().encode('ancien'));
    const path = await s.save('ChronoCast-Setup-0.5.1.exe', new TextEncoder().encode('nouveau'));

    await expect(readFile(path, 'utf8')).resolves.toBe('nouveau');
  });

  it('vide le répertoire sans le supprimer', async () => {
    const s = store();
    await s.save('ChronoCast-Setup-0.5.1.exe', new TextEncoder().encode('MZ'));

    await s.clear();

    await expect(readdir(join(root, UPDATES_DIRECTORY))).resolves.toEqual([]);
  });

  it('vide un répertoire qui n’existe pas, sans lever', async () => {
    // `clear()` est appelé au démarrage, avant tout téléchargement : lever ici
    // ferait échouer le lancement de l'application pour un répertoire absent.
    await expect(store().clear()).resolves.toBeUndefined();
  });

  it('emporte aussi les fichiers qui ne sont pas des installeurs', async () => {
    const directory = join(root, UPDATES_DIRECTORY);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'residu.part'), 'à moitié');

    await store().clear();

    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it('refuse un nom qui sortirait du répertoire', async () => {
    // Le nom vient d'un asset de release, déjà confronté à celui qu'on attend.
    // Le contrôle est refait ici parce que c'est ici qu'on écrit.
    await expect(store().save('../evasion.exe', new Uint8Array([0]))).rejects.toThrow();
  });
});
