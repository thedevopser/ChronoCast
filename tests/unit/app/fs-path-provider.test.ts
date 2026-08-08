import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFsPathProvider, defaultWebRoot } from '../../../src/core/app/fs-path-provider.js';

describe('createFsPathProvider', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('choix de la racine', () => {
    it('retient la racine explicite, prioritaire sur tout le reste', () => {
      vi.stubEnv('CHRONOCAST_DATA_DIR', '/tmp/depuis-environnement');

      const paths = createFsPathProvider({
        dataDirectory: '/tmp/explicite',
        webRootDirectory: '/app/public',
      });

      expect(paths.dataDirectory).toBe(resolve('/tmp/explicite'));
    });

    it('retient la racine de l’environnement à défaut d’explicite', () => {
      vi.stubEnv('CHRONOCAST_DATA_DIR', '/tmp/depuis-environnement');

      const paths = createFsPathProvider({ webRootDirectory: '/app/public' });

      expect(paths.dataDirectory).toBe(resolve('/tmp/depuis-environnement'));
    });

    it('ignore une variable d’environnement vide', () => {
      vi.stubEnv('CHRONOCAST_DATA_DIR', '');

      const paths = createFsPathProvider({ webRootDirectory: '/app/public' });

      expect(paths.dataDirectory).toBe(resolve(join(homedir(), '.chronocast')));
    });

    it('se replie sous le répertoire personnel', () => {
      vi.stubEnv('CHRONOCAST_DATA_DIR', undefined);

      const paths = createFsPathProvider({ webRootDirectory: '/app/public' });

      expect(paths.dataDirectory).toBe(resolve(join(homedir(), '.chronocast')));
    });

    it('rend absolue une racine relative', () => {
      const paths = createFsPathProvider({
        dataDirectory: 'donnees-relatives',
        webRootDirectory: 'public-relatif',
      });

      expect(paths.dataDirectory).toBe(resolve('donnees-relatives'));
      expect(paths.webRootDirectory).toBe(resolve('public-relatif'));
    });
  });

  describe('répertoires dérivés', () => {
    it('range journaux et historique sous la racine des données', () => {
      const paths = createFsPathProvider({
        dataDirectory: '/tmp/racine',
        webRootDirectory: '/app/public',
      });

      expect(paths.logsDirectory).toBe(join(resolve('/tmp/racine'), 'logs'));
      expect(paths.historyDirectory).toBe(join(resolve('/tmp/racine'), 'history'));
    });

    it('garde la racine web hors de celle des données', () => {
      const paths = createFsPathProvider({
        dataDirectory: '/tmp/racine',
        webRootDirectory: '/app/dist/public',
      });

      expect(paths.webRootDirectory).toBe(resolve('/app/dist/public'));
      expect(paths.webRootDirectory.startsWith(paths.dataDirectory)).toBe(false);
    });
  });

  describe('resolveDataFile', () => {
    const paths = createFsPathProvider({
      dataDirectory: '/tmp/racine',
      webRootDirectory: '/app/public',
    });
    const root = resolve('/tmp/racine');

    it('compose un chemin sous la racine', () => {
      expect(paths.resolveDataFile('config.json')).toBe(join(root, 'config.json'));
      expect(paths.resolveDataFile('history', 'events.jsonl')).toBe(
        join(root, 'history', 'events.jsonl'),
      );
    });

    it('accepte un appel sans segment', () => {
      expect(paths.resolveDataFile()).toBe(root);
    });

    it('refuse de remonter au-dessus de la racine', () => {
      expect(() => paths.resolveDataFile('..', 'ailleurs.json')).toThrow(
        /hors de la racine/,
      );
      expect(() => paths.resolveDataFile('history/../../ailleurs.json')).toThrow(
        /hors de la racine/,
      );
    });

    it('neutralise un segment absolu au lieu de le laisser écraser la racine', () => {
      expect(paths.resolveDataFile('/etc/passwd')).toBe(join(root, 'etc', 'passwd'));
    });

    it('accepte un répertoire dont le nom commence comme la racine', () => {
      expect(paths.resolveDataFile('racine-bis', 'fichier.json')).toBe(
        join(root, 'racine-bis', 'fichier.json'),
      );
    });
  });
});

describe('defaultWebRoot', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const entryUrl = (...segments: string[]): string =>
    pathToFileURL(resolve(join('/app/dist', ...segments))).href;

  it('place la racine web à côté du code compilé du point d’entrée', () => {
    vi.stubEnv('CHRONOCAST_WEB_ROOT', undefined);

    expect(defaultWebRoot(entryUrl('headless', 'index.js'))).toBe(resolve('/app/dist/public'));
  });

  it('donne la même racine aux deux points d’entrée', () => {
    vi.stubEnv('CHRONOCAST_WEB_ROOT', undefined);

    expect(defaultWebRoot(entryUrl('main', 'main.js'))).toBe(
      defaultWebRoot(entryUrl('headless', 'index.js')),
    );
  });

  it('laisse l’environnement imposer une racine', () => {
    vi.stubEnv('CHRONOCAST_WEB_ROOT', '/ailleurs/public');

    expect(defaultWebRoot(entryUrl('headless', 'index.js'))).toBe('/ailleurs/public');
  });

  it('ignore une variable vide', () => {
    vi.stubEnv('CHRONOCAST_WEB_ROOT', '');

    expect(defaultWebRoot(entryUrl('headless', 'index.js'))).toBe(resolve('/app/dist/public'));
  });
});
