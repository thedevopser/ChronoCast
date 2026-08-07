import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';


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

/**
 * Marqueur des valeurs d'identité que Partner Center n'a pas encore assignées.
 *
 * Il doit rester reconnaissable d'un coup d'œil : une identité fausse produit
 * un paquet en tout point valide, que rien ne distingue d'un paquet
 * soumettable avant le rejet de certification, un à trois jours plus tard.
 */
const IDENTITY_PLACEHOLDER = 'IDENTITE-PARTNER-CENTER';

describe('electron-builder.yml', () => {
  it('nomme le produit exactement comme `app.setName`', async () => {
    // C'est l'invariant le plus coûteux à violer. `productName` détermine
    // `%APPDATA%\ChronoCast`, d'où la reprise des données va chercher
    // l'installation précédente. Un désaccord entre les deux ferait chercher
    // dans un répertoire que personne n'a jamais écrit : la reprise ne
    // trouverait rien, et l'utilisateur retrouverait une installation neuve
    // sans le moindre message.
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

  it('ne cible que Windows, en AppX', async () => {
    // Le Store est le seul canal de distribution : plus aucun installeur NSIS
    // n'est produit ni publié. En laisser la cible reviendrait à entretenir un
    // second chemin de packaging que rien n'éprouve — le plus sûr moyen qu'il
    // casse en silence.
    const config = await read('electron-builder.yml');

    expect(config).toContain('target: appx');
    expect(config).not.toContain('target: nsis');
    expect(config).not.toContain('nsis:');
    expect(config).not.toContain('mac:');
    expect(config).not.toContain('linux:');
  });

  it('déclare une identité de paquet réellement assignée par Partner Center', async () => {
    // `identityName`, `publisher` et `publisherDisplayName` viennent de la
    // fiche du produit dans Partner Center. Soumettre un paquet dont l'identité
    // ne correspond pas à celle réservée le fait **rejeter à la certification**,
    // c'est-à-dire un à trois jours plus tard.
    const config = await read('electron-builder.yml');

    expect(config).toMatch(/^ {2}identityName: \S+$/m);
    expect(config).toMatch(/^ {2}publisher: CN=\S+/m);
    expect(config).toMatch(/^ {2}publisherDisplayName: \S+/m);
  });

  it('déclare la tâche de démarrage, faute de pouvoir l’écrire au registre', async () => {
    // `setLoginItemSettings` écrit dans `HKCU\…\Run`, que MSIX virtualise :
    // la valeur n'atteint jamais le vrai registre. Sans cette extension, rien
    // ne démarrerait avec la session, et **rien ne le dirait**.
    const config = await read('electron-builder.yml');

    expect(config).toContain('customExtensionsPath: assets/appx/extensions.xml');

    const manifest = await read('assets/appx/extensions.xml');
    expect(manifest).toContain('windows.startupTask');
    expect(manifest).toContain('Windows.FullTrustApplication');
    // Le défaut d'avant : une application qui s'installe au démarrage sans
    // rien dire est une application qu'on désinstalle.
    expect(manifest).toContain('Enabled="false"');
  });

  it('confie au workflow le refus des valeurs d’identité en attente', async () => {
    // L'identité vient de Partner Center, et peut n'être pas encore connue
    // pendant le développement. Le refus ne vit donc **pas ici** : un paquet
    // bâti sur une identité marqueuse reste parfaitement utile pour éprouver
    // le packaging par chargement latéral, il n'est simplement pas soumettable.
    //
    // C'est le workflow `Release` qui le refuse, et seulement sur un tag. Ce
    // test tient les deux accordés : le marqueur que le workflow cherche doit
    // rester celui que ce fichier connaît.
    const workflow = await read('.github/workflows/release.yml');

    expect(workflow).toContain(IDENTITY_PLACEHOLDER);
  });

  it('ne porte aucune identité en attente sur une ligne de valeur', async () => {
    // Le contrôle porte sur les **lignes de valeur**, jamais sur le fichier
    // entier : le marqueur est cité dans les commentaires qui l'expliquent, et
    // une recherche naïve y verrait une identité en attente. C'est exactement
    // le motif que cherche le workflow, écrit ici sous la même forme.
    const config = await read('electron-builder.yml');

    expect(config).not.toMatch(
      new RegExp(`^\\s*(identityName|publisher|publisherDisplayName):.*${IDENTITY_PLACEHOLDER}`, 'm'),
    );
  });

  /**
   * Le fragment d'extensions du manifeste AppX.
   *
   * Ces deux tests existent parce que leur absence a coûté un build. Le fichier
   * était syntaxiquement valide, `packaging.test.ts` y trouvait toutes les
   * chaînes attendues, et `makeappx.exe` l'a refusé sur le runner Windows —
   * c'est-à-dire au seul endroit où le conteneur ne voit rien.
   *
   * Le manifeste engendré n'est validé qu'au packaging. Ce qui suit est donc la
   * seule barrière avant lui.
   */
  describe('assets/appx/extensions.xml', () => {
    /** Le gabarit de manifeste d'electron-builder, source de vérité des préfixes. */
    const TEMPLATE = 'node_modules/app-builder-lib/templates/appx/appxmanifest.xml';

    /**
     * Le fragment débarrassé de ses commentaires.
     *
     * Ils citent le balisage qu'ils expliquent — `<Extensions>`, les préfixes
     * écartés — et une recherche naïve y verrait le défaut qu'elle cherche.
     * C'est le même piège que le marqueur d'identité de Partner Center : ce
     * qu'on contrôle est le **balisage effectif**, jamais le texte du fichier.
     */
    async function markup(): Promise<string> {
      return (await read('assets/appx/extensions.xml')).replace(/<!--[\s\S]*?-->/g, '');
    }

    it('est un fragment, sans balise `Extensions` racine', async () => {
      // electron-builder écrit `<Extensions>` lui-même et **concatène** ce
      // fichier à l'intérieur. Une balise racine ici produit un
      // `<Extensions><Extensions>`, que `makeappx.exe` refuse avec un message
      // qui ne dit pas d'où vient le doublon.
      const fragment = await markup();

      expect(fragment).not.toMatch(/<Extensions[\s>]/);
      expect(fragment).not.toContain('</Extensions>');
      expect(fragment).toMatch(/<\w+:Extension\s/);
    });

    it('n’emploie que des préfixes de namespace déclarés par le gabarit', async () => {
      // Le gabarit ne déclare que `uap`, `desktop` et `rescap`. Un `uap5:` y
      // est un préfixe **non lié** : le manifeste est alors invalide, et rien
      // dans ce dépôt ne le dirait avant le runner Windows.
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
      // Le chemin est relatif à la racine du paquet, et electron-builder place
      // l'application sous `app\` — voir `AppxTarget.js`, qui compose
      // `app\${productFilename}.exe`. Sans ce préfixe, `makeappx` refuse le
      // manifeste : le fichier déclaré n'existe pas dans le paquet.
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
    // C'est le workflow de release qui produit l'artefact, après avoir vérifié
    // la cohérence du tag, et c'est l'utilisateur qui le dépose dans Partner
    // Center. Publier depuis le build court-circuiterait ce contrôle.
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
