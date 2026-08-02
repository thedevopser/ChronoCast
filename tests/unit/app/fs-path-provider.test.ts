import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFsPathProvider, defaultWebRoot } from '../../../src/core/app/fs-path-provider.js';

/**
 * Fournisseur de chemins, implémentation du port `PathProvider`.
 *
 * Il vit dans `core/app/` et non dans un point d'entrée, aux côtés de
 * `system-clock` et `system-ticker`, parce qu'il a désormais deux appelants :
 * le point d'entrée headless, qui le laisse choisir sa racine, et la coquille
 * Electron, qui lui impose `app.getPath('userData')` — soit
 * `%APPDATA%\ChronoCast` sous Windows.
 *
 * Il n'était couvert par aucun test jusqu'ici. C'est d'autant moins tenable
 * qu'il porte une garde : composer un chemin de données ne doit jamais
 * permettre d'en sortir.
 */
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

      // C'est la voie qu'emprunte la coquille Electron : elle sait où sont les
      // données de l'utilisateur, l'environnement n'a pas à la contredire.
      expect(paths.dataDirectory).toBe(resolve('/tmp/explicite'));
    });

    it('retient la racine de l’environnement à défaut d’explicite', () => {
      vi.stubEnv('CHRONOCAST_DATA_DIR', '/tmp/depuis-environnement');

      const paths = createFsPathProvider({ webRootDirectory: '/app/public' });

      expect(paths.dataDirectory).toBe(resolve('/tmp/depuis-environnement'));
    });

    it('ignore une variable d’environnement vide', () => {
      // Une variable définie mais vide est une variable non renseignée : la
      // traiter comme une racine ferait écrire à la racine du système.
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
      // Le contenu servi est livré avec l'application : il n'a rien à faire
      // dans le répertoire modifiable de l'utilisateur.
      const paths = createFsPathProvider({
        dataDirectory: '/tmp/racine',
        webRootDirectory: '/app/dist/public',
      });

      expect(paths.webRootDirectory).toBe('/app/dist/public');
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
      // Le contrat du port l'exige. Un segment `..` est une erreur de
      // programmation, et il vaut mieux la voir tout de suite qu'écrire hors
      // du répertoire de données.
      expect(() => paths.resolveDataFile('..', 'ailleurs.json')).toThrow(
        /hors de la racine/,
      );
      expect(() => paths.resolveDataFile('history/../../ailleurs.json')).toThrow(
        /hors de la racine/,
      );
    });

    it('neutralise un segment absolu au lieu de le laisser écraser la racine', () => {
      // `join` aplatit un segment absolu en segment relatif — c'est `resolve`
      // seul qui lui aurait laissé reprendre la main. Le chemin reste donc sous
      // la racine, ce que le contrat exige, et le cas ne lève pas : il n'y a
      // rien d'anormal à demander un fichier nommé `etc/passwd` chez soi.
      expect(paths.resolveDataFile('/etc/passwd')).toBe(join(root, 'etc', 'passwd'));
    });

    it('accepte un répertoire dont le nom commence comme la racine', () => {
      // Piège classique de la comparaison par préfixe : `/tmp/racine-bis` ne
      // doit pas passer pour un enfant de `/tmp/racine`, et réciproquement un
      // enfant légitime ne doit pas être refusé.
      expect(paths.resolveDataFile('racine-bis', 'fichier.json')).toBe(
        join(root, 'racine-bis', 'fichier.json'),
      );
    });
  });
});

/**
 * Racine par défaut des ressources web.
 *
 * Elle est calculée depuis l'URL du module **appelant**, et non depuis celle de
 * ce fichier-ci : les deux points d'entrée compilés — `dist/headless/index.js`
 * et `dist/main/main.js` — sont chacun à un niveau sous `dist/`, alors que ce
 * module est enfoui plus profond. Le mesurer depuis lui donnerait un chemin
 * juste pour l'un et faux pour l'autre, et surtout un chemin qui changerait à
 * la première réorganisation de `src/core`.
 */
describe('defaultWebRoot', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('place la racine web à côté du code compilé du point d’entrée', () => {
    vi.stubEnv('CHRONOCAST_WEB_ROOT', undefined);

    expect(defaultWebRoot('file:///app/dist/headless/index.js')).toBe('/app/dist/public');
  });

  it('donne la même racine aux deux points d’entrée', () => {
    vi.stubEnv('CHRONOCAST_WEB_ROOT', undefined);

    expect(defaultWebRoot('file:///app/dist/main/main.js')).toBe(
      defaultWebRoot('file:///app/dist/headless/index.js'),
    );
  });

  it('laisse l’environnement imposer une racine', () => {
    // C'est ce qui permet de servir une compilation en cours pendant le
    // développement, sans toucher au code.
    vi.stubEnv('CHRONOCAST_WEB_ROOT', '/ailleurs/public');

    expect(defaultWebRoot('file:///app/dist/headless/index.js')).toBe('/ailleurs/public');
  });

  it('ignore une variable vide', () => {
    vi.stubEnv('CHRONOCAST_WEB_ROOT', '');

    expect(defaultWebRoot('file:///app/dist/headless/index.js')).toBe('/app/dist/public');
  });
});
