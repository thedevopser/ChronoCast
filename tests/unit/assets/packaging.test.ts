import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const read = (relative: string): Promise<string> => readFile(resolve(ROOT, relative), 'utf8');

const IDENTITY_PLACEHOLDER = 'IDENTITE-PARTNER-CENTER';

describe('electron-builder.yml', () => {
  it('nomme le produit exactement comme `app.setName`', async () => {
    const [config, main] = await Promise.all([
      read('electron-builder.yml'),
      read('src/main/main.ts'),
    ]);

    expect(config).toContain('productName: ChronoCast');
    expect(main).toContain("app.setName('ChronoCast')");
  });

  it('embarque le répertoire des icônes', async () => {
    const config = await read('electron-builder.yml');

    expect(config).toContain('assets/**/*');
    expect(config).toContain('dist/**/*');
  });

  it('désigne une icône qui existe réellement', async () => {
    const config = await read('electron-builder.yml');

    expect(config).toContain('assets/icon.ico');
    await expect(readFile(resolve(ROOT, 'assets', 'icon.ico'))).resolves.toBeDefined();
  });

  it('ne cible que Windows, en AppX', async () => {
    const config = await read('electron-builder.yml');

    expect(config).toContain('target: appx');
    expect(config).not.toContain('target: nsis');
    expect(config).not.toContain('nsis:');
    expect(config).not.toContain('mac:');
    expect(config).not.toContain('linux:');
  });

  it('déclare une identité de paquet réellement assignée par Partner Center', async () => {
    const config = await read('electron-builder.yml');

    expect(config).toMatch(/^ {2}identityName: \S+$/m);
    expect(config).toMatch(/^ {2}publisher: CN=\S+/m);
    expect(config).toMatch(/^ {2}publisherDisplayName: \S+/m);
  });

  it('déclare la tâche de démarrage, faute de pouvoir l’écrire au registre', async () => {
    const config = await read('electron-builder.yml');

    expect(config).toContain('customExtensionsPath: assets/appx/extensions.xml');

    const manifest = await read('assets/appx/extensions.xml');
    expect(manifest).toContain('windows.startupTask');
    expect(manifest).toContain('Windows.FullTrustApplication');
    expect(manifest).toContain('Enabled="false"');
  });

  it('confie au workflow le refus des valeurs d’identité en attente', async () => {
    const workflow = await read('.github/workflows/release.yml');

    expect(workflow).toContain(IDENTITY_PLACEHOLDER);
  });

  it('ne porte aucune identité en attente sur une ligne de valeur', async () => {
    const config = await read('electron-builder.yml');

    expect(config).not.toMatch(
      new RegExp(`^\\s*(identityName|publisher|publisherDisplayName):.*${IDENTITY_PLACEHOLDER}`, 'm'),
    );
  });

  describe('assets/appx/extensions.xml', () => {
    const TEMPLATE = 'node_modules/app-builder-lib/templates/appx/appxmanifest.xml';

    async function markup(): Promise<string> {
      return (await read('assets/appx/extensions.xml')).replace(/<!--[\s\S]*?-->/g, '');
    }

    it('est un fragment, sans balise `Extensions` racine', async () => {
      const fragment = await markup();

      expect(fragment).not.toMatch(/<Extensions[\s>]/);
      expect(fragment).not.toContain('</Extensions>');
      expect(fragment).toMatch(/<\w+:Extension\s/);
    });

    it('n’emploie que des préfixes de namespace déclarés par le gabarit', async () => {
      const [fragment, template] = await Promise.all([markup(), read(TEMPLATE)]);

      const declared = new Set(
        [...template.matchAll(/xmlns:(\w+)=/g)].map((match) => match[1]),
      );
      expect(declared.size).toBeGreaterThan(0);

      const used = new Set(
        [...fragment.matchAll(/<\/?(\w+):/g)].map((match) => match[1]),
      );

      for (const prefix of used) {
        expect(declared).toContain(prefix);
      }
    });

    it('nomme l’exécutable exactement comme electron-builder l’empaquette', async () => {
      const [fragment, config] = await Promise.all([
        markup(),
        read('electron-builder.yml'),
      ]);

      const productName = /^productName: (\S+)$/m.exec(config)?.[1];
      expect(productName).toBeDefined();
      expect(fragment).toContain(`Executable="app\\${String(productName)}.exe"`);
    });
  });

  it('ne publie rien depuis le build', async () => {
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
    const manifest = JSON.parse(await read('package.json')) as {
      readonly dependencies: Record<string, string>;
      readonly devDependencies: Record<string, string>;
    };

    expect(Object.keys(manifest.dependencies).sort()).toEqual(['ws', 'zod']);
    expect(manifest.devDependencies).toHaveProperty('electron');
    expect(manifest.devDependencies).toHaveProperty('electron-builder');
  });

  it('n’embarque pas les cartes de source', async () => {
    const config = await read('electron-builder.yml');

    expect(config).toContain("'!**/*.map'");
  });

  it('fige les versions d’electron et d’electron-builder', async () => {
    const manifest = JSON.parse(await read('package.json')) as {
      readonly devDependencies: Record<string, string>;
    };

    expect(manifest.devDependencies['electron']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.devDependencies['electron-builder']).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('cohérence de la version', () => {
  it('annonce la même version dans le manifeste et dans le code', async () => {
    const manifest = JSON.parse(await read('package.json')) as { readonly version: string };
    const { APP_VERSION } = await import('../../../src/core/app/version.js');

    expect(APP_VERSION).toBe(manifest.version);
  });

  it('emploie une version sémantique', async () => {
    const manifest = JSON.parse(await read('package.json')) as { readonly version: string };

    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
