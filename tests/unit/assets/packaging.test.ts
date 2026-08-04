import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { INSTALLER_PREFIX } from '../../../src/core/update/release-feed.js';

/**
 * Cohérence de la configuration de packaging.
 *
 * Rien de ce qui suit ne se vérifie en exécutant l'application : ces défauts
 * n'apparaissent qu'après un build, sur un poste Windows, et certains **ne
 * lèvent jamais** — une icône manquante donne un tray vide, un `productName`
 * désaccordé déplace silencieusement le répertoire de données. C'est pourquoi
 * ils sont tenus ici.
 *
 * Ce n'est volontairement pas un analyseur YAML : le fichier est court, et
 * écrire un parseur pour le vérifier reviendrait à tester notre parseur plutôt
 * que la configuration. Les invariants sont donc cherchés tels qu'ils sont
 * écrits — ce qui suffit, puisqu'un invariant absent est précisément ce qu'on
 * veut détecter.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const read = (relative: string): Promise<string> => readFile(resolve(ROOT, relative), 'utf8');

describe('electron-builder.yml', () => {
  it('nomme le produit exactement comme `app.setName`', async () => {
    // C'est l'invariant le plus coûteux à violer. `productName` détermine
    // `%APPDATA%\ChronoCast`, où vivent la configuration, l'état du compteur et
    // les jetons. Un désaccord entre les deux déplacerait ce répertoire d'une
    // version à l'autre : l'utilisateur retrouverait une installation neuve, et
    // son subathon en cours serait perdu sans le moindre message.
    const [config, main] = await Promise.all([
      read('electron-builder.yml'),
      read('src/main/main.ts'),
    ]);

    expect(config).toContain('productName: ChronoCast');
    expect(main).toContain("app.setName('ChronoCast')");
  });

  it('embarque le répertoire des icônes', async () => {
    // `src/main/main.ts` résout l'icône de la fenêtre et celle du tray sous
    // `assets/`. L'omettre des fichiers du paquet donnerait l'icône par défaut
    // d'Electron et un tray vide, sans qu'Electron n'avertisse de rien.
    const config = await read('electron-builder.yml');

    expect(config).toContain('assets/**/*');
    expect(config).toContain('dist/**/*');
  });

  it('désigne une icône qui existe réellement', async () => {
    const config = await read('electron-builder.yml');

    expect(config).toContain('assets/icon.ico');
    await expect(readFile(resolve(ROOT, 'assets', 'icon.ico'))).resolves.toBeDefined();
  });

  it('ne cible que Windows, en NSIS', async () => {
    // Linux et macOS sont hors périmètre de la V1. Une cible ajoutée par
    // inadvertance allongerait le build et produirait un artefact que personne
    // n'a demandé ni éprouvé.
    const config = await read('electron-builder.yml');

    expect(config).toContain('target: nsis');
    expect(config).not.toContain('mac:');
    expect(config).not.toContain('linux:');
  });

  it('conserve les données de l’utilisateur à la désinstallation', async () => {
    // Réinstaller est ce qu'on fait quand quelque chose ne va pas : un
    // subathon en cours doit y survivre.
    const config = await read('electron-builder.yml');

    expect(config).toContain('deleteAppDataOnUninstall: false');
  });

  it('n’installe que pour l’utilisateur courant', async () => {
    // L'application n'écrit que dans `%APPDATA%`, et `safeStorage` lie de toute
    // façon les secrets au compte Windows. Une invite UAC sur un binaire non
    // signé est par ailleurs le meilleur moyen de faire renoncer quelqu'un.
    const config = await read('electron-builder.yml');

    expect(config).toContain('perMachine: false');
  });

  it('nomme l’installeur exactement comme l’updater le cherche', async () => {
    // `release-feed.ts` compose le nom de l'asset qu'il attend sur une release
    // — `ChronoCast-Setup-<version>.exe` — et ne retient que celui-là, pour
    // qu'un artefact étranger déposé sur la release ne puisse pas s'y
    // substituer. Renommer l'artefact ici rendrait donc **toutes les releases
    // suivantes invisibles** à la mise à jour automatique, sans la moindre
    // erreur : les postes installés chercheraient un fichier qui n'existe plus
    // et concluraient tranquillement qu'ils sont à jour.
    const config = await read('electron-builder.yml');

    expect(config).toContain(`artifactName: ${INSTALLER_PREFIX}\${version}.\${ext}`);
  });

  it('ne publie rien depuis le build', async () => {
    // C'est le workflow de release qui attache l'installeur, après avoir
    // vérifié la cohérence du tag. Publier depuis le build court-circuiterait
    // ce contrôle.
    const config = await read('electron-builder.yml');

    expect(config).toContain('publish: null');
  });
});

describe('package.json', () => {
  it('désigne le point d’entrée compilé de la coquille', async () => {
    const manifest = JSON.parse(await read('package.json')) as { readonly main?: string };

    expect(manifest.main).toBe('dist/main/main.js');
  });

  it('garde electron et electron-builder hors des dépendances de production', async () => {
    // electron-builder refuse de packager si Electron est en dépendance de
    // production, et embarquer l'outil de build dans l'installeur n'aurait
    // aucun sens. Les dépendances de production restent celles du modèle de
    // menace : `ws` et `zod`, et rien d'autre.
    const manifest = JSON.parse(await read('package.json')) as {
      readonly dependencies: Record<string, string>;
      readonly devDependencies: Record<string, string>;
    };

    expect(Object.keys(manifest.dependencies).sort()).toEqual(['ws', 'zod']);
    expect(manifest.devDependencies).toHaveProperty('electron');
    expect(manifest.devDependencies).toHaveProperty('electron-builder');
  });

  it('n’embarque pas les cartes de source', async () => {
    // Elles ne servent qu'au développement : les outils de développement sont
    // fermés dans une application packagée, personne ne les lira jamais. Elles
    // pèsent en revanche plusieurs centaines de kilooctets dans l'installeur, et
    // celles du code web étaient de surcroît servies en 404 — la liste blanche
    // du serveur statique ne les connaît pas. Livrer un fichier inaccessible et
    // inutile est le genre de détail qui fait douter du reste.
    const config = await read('electron-builder.yml');

    expect(config).toContain("'!**/*.map'");
  });

  it('fige les versions d’electron et d’electron-builder', async () => {
    // Elles déterminent le Chromium embarqué et la forme de l'installeur,
    // c'est-à-dire ce que le conteneur ne peut pas vérifier. Un intervalle de
    // versions y ferait entrer un changement que personne n'aurait décidé.
    const manifest = JSON.parse(await read('package.json')) as {
      readonly devDependencies: Record<string, string>;
    };

    expect(manifest.devDependencies['electron']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.devDependencies['electron-builder']).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('cohérence de la version', () => {
  it('annonce la même version dans le manifeste et dans le code', async () => {
    // Deux endroits portent la version : `package.json`, d'où electron-builder
    // tire le nom de l'installeur et d'où `app.getVersion()` la lit, et une
    // constante du noyau, parce que le point d'entrée headless n'a pas accès au
    // premier. Rien ne garantissait leur alignement : le jour où l'un des deux
    // est oublié, headless annonce une version fausse à ses clients WebSocket,
    // et rien ne le signale.
    //
    // La duplication est conservée plutôt que résolue par une lecture de
    // `package.json` à l'exécution : celle-ci dépendrait de la disposition des
    // fichiers émis, qui change au packaging. Un test la tient, comme il tient
    // déjà `productName` et `app.setName`.
    const manifest = JSON.parse(await read('package.json')) as { readonly version: string };
    const { APP_VERSION } = await import('../../../src/core/app/version.js');

    expect(APP_VERSION).toBe(manifest.version);
  });

  it('emploie une version sémantique', async () => {
    const manifest = JSON.parse(await read('package.json')) as { readonly version: string };

    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
