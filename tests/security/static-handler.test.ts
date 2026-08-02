import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createLogger, type LogRecord, type LogSink } from '../../src/core/logging/logger.js';
import {
  contentTypeFor,
  createStaticHandler,
  resolveStaticPath,
  type StaticHandler,
} from '../../src/core/server/static-handler.js';

/**
 * Servir des fichiers est l'opération la plus banale d'un serveur, et la plus
 * facile à rater. Un chemin venu du réseau qui traverse la racine donne accès à
 * tout ce que le processus peut lire — et ChronoCast tourne sous le compte du
 * streamer, avec ses jetons Twitch chiffrés à côté.
 *
 * La règle est donc unique et sans exception : on résout, puis on vérifie que le
 * chemin **résolu** reste sous la racine. Filtrer la chaîne d'entrée ne marche
 * jamais, il y a toujours un encodage de plus.
 */

/** Octet nul, construit sans séquence d'échappement pour ne pas polluer le fichier. */
const NUL = String.fromCharCode(0);

function createMemorySink(): LogSink & { readonly records: LogRecord[] } {
  const records: LogRecord[] = [];
  return {
    name: 'memory',
    records,
    write(record: LogRecord): void {
      records.push(record);
    },
  };
}

describe('resolveStaticPath', () => {
  // `resolve` d'un chemin POSIX écrit en dur y ajoute la lettre de lecteur sous
  // Windows — `/srv/...` devient `D:\srv\...` — et l'égalité attendue ne tient
  // plus. La racine est donc construite par la plateforme elle-même, ce qui est
  // de toute façon plus proche de la réalité : elle vient d'un `PathProvider`.
  const root = resolve('/srv/chronocast/public');

  it('résout un chemin simple', () => {
    expect(resolveStaticPath(root, '/overlay/index.html')).toBe(
      join(root, 'overlay', 'index.html'),
    );
  });

  it('résout un chemin sans barre oblique initiale', () => {
    expect(resolveStaticPath(root, 'admin/app.js')).toBe(join(root, 'admin', 'app.js'));
  });

  it("traite une barre oblique initiale comme relative à la racine web", () => {
    // Sémantique HTTP normale : `/admin/app.js` désigne un fichier du site, pas
    // un chemin absolu du disque.
    expect(resolveStaticPath(root, '/admin/app.js')).toBe(join(root, 'admin', 'app.js'));
  });

  describe('rejette les traversées', () => {
    const rejected = [
      '/../secrets.json',
      '/../../etc/passwd.json',
      '/overlay/../../config.json',
      '/overlay/../../../../../../etc/shadow.json',
      './../config.json',
      // Le point d'entrée a déjà décodé une fois : un `%` résiduel signale un
      // double encodage, jamais un nom de fichier de ChronoCast.
      '/..%2fconfig.json',
      '/%2e%2e/config.json',
      // Séparateur Windows : la cible de la V1 est Windows, où `\` sépare aussi.
      '\\..\\config.json',
      '/overlay\\..\\..\\config.json',
      // Octet nul : tronque le chemin dans certaines couches basses.
      `/overlay/index.html${NUL}.png`,
    ];

    it.each(rejected)('rejette %j', (pathname) => {
      expect(resolveStaticPath(root, pathname)).toBeNull();
    });
  });

  describe("rejette ce qui n'est pas sur la liste blanche", () => {
    const rejected = [
      '/config.json.bak',
      '/tokens',
      '/overlay/index.htm',
      '/script.sh',
      '/dump.log',
      '/archive.zip',
      // Aucune extension du tout : c'est un répertoire ou un piège.
      '/overlay',
      '/',
    ];

    it.each(rejected)('rejette %j', (pathname) => {
      expect(resolveStaticPath(root, pathname)).toBeNull();
    });
  });

  it.each(['.html', '.css', '.js', '.svg', '.png', '.ico', '.woff', '.woff2', '.json'])(
    'accepte %s',
    (extension) => {
      expect(resolveStaticPath(root, `/fichier${extension}`)).not.toBeNull();
    },
  );

  it("accepte l'extension quelle qu'en soit la casse", () => {
    expect(resolveStaticPath(root, '/LOGO.PNG')).not.toBeNull();
  });
});

describe('contentTypeFor', () => {
  it.each([
    ['/a/index.html', 'text/html; charset=utf-8'],
    ['/a/style.css', 'text/css; charset=utf-8'],
    ['/a/app.js', 'text/javascript; charset=utf-8'],
    ['/a/icon.svg', 'image/svg+xml'],
    ['/a/logo.png', 'image/png'],
    ['/a/favicon.ico', 'image/x-icon'],
    ['/a/font.woff2', 'font/woff2'],
    ['/a/data.json', 'application/json; charset=utf-8'],
  ])('%s → %s', (filePath, expected) => {
    expect(contentTypeFor(filePath)).toBe(expected);
  });

  it("renvoie null pour une extension inconnue plutôt qu'un type générique", () => {
    // `application/octet-stream` inviterait le navigateur à télécharger un
    // fichier qui n'aurait jamais dû être servi : mieux vaut ne rien servir.
    expect(contentTypeFor('/a/archive.zip')).toBeNull();
  });
});

describe('createStaticHandler', () => {
  let base: string;
  let root: string;
  let outside: string;
  let handler: StaticHandler;
  let sink: LogSink & { readonly records: LogRecord[] };

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'chronocast-static-'));
    root = join(base, 'public');
    outside = join(base, 'prive');

    await mkdir(join(root, 'overlay'), { recursive: true });
    await mkdir(outside, { recursive: true });

    await writeFile(join(root, 'overlay', 'index.html'), '<!doctype html><p>overlay</p>', 'utf8');
    await writeFile(join(root, 'overlay', 'style.css'), 'body{margin:0}', 'utf8');
    await writeFile(join(outside, 'tokens.json'), '{"secret":"tres-confidentiel"}', 'utf8');

    sink = createMemorySink();
    handler = createStaticHandler({
      rootDirectory: root,
      logger: createLogger({ level: 'debug', sinks: [sink] }),
    });
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('sert un fichier existant avec son type MIME', async () => {
    const response = await handler.serve('/overlay/index.html');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(response.body.toString()).toContain('overlay');
  });

  it('renseigne la longueur du contenu', async () => {
    const response = await handler.serve('/overlay/style.css');
    expect(response.headers['content-length']).toBe(String(Buffer.byteLength('body{margin:0}')));
  });

  it('répond 404 sur un fichier absent', async () => {
    expect((await handler.serve('/overlay/absent.html')).status).toBe(404);
  });

  it('répond 404 — et non 403 — sur une traversée', async () => {
    // Un 403 confirmerait à l'attaquant que le chemin visé existe. Une réponse
    // indifférenciée ne lui apprend rien.
    const traversal = await handler.serve('/../prive/tokens.json');
    const missing = await handler.serve('/absent.json');

    expect(traversal.status).toBe(404);
    expect(traversal.body).toEqual(missing.body);
  });

  it('ne divulgue jamais le contenu situé hors de la racine', async () => {
    const response = await handler.serve('/../prive/tokens.json');
    expect(response.body.toString()).not.toContain('tres-confidentiel');
  });

  it('refuse de suivre un lien symbolique sortant de la racine', async () => {
    // Le contrôle de préfixe sur le chemin résolu ne voit pas les liens : il faut
    // canoniser après coup, sinon un lien déposé dans la racine ouvre tout le disque.
    await symlink(join(outside, 'tokens.json'), join(root, 'fuite.json'));

    const response = await handler.serve('/fuite.json');

    expect(response.status).toBe(404);
    expect(response.body.toString()).not.toContain('tres-confidentiel');
  });

  it('répond 404 sur un répertoire, sans en lister le contenu', async () => {
    const response = await handler.serve('/overlay');

    expect(response.status).toBe(404);
    expect(response.body.toString()).not.toContain('index.html');
  });

  it('journalise le rejet sans faire échouer la requête', async () => {
    await handler.serve('/../prive/tokens.json');
    expect(sink.records.some((record) => record.level === 'warning')).toBe(true);
  });

  it('produit un corps de 404 identique quelle que soit la cause', async () => {
    const absent = await handler.serve('/absent.html');
    const forbiddenExtension = await handler.serve('/secrets.env');

    expect(absent.status).toBe(404);
    expect(forbiddenExtension.status).toBe(404);
    expect(absent.body).toEqual(forbiddenExtension.body);
  });
});

/**
 * Racine atteinte par un chemin qui n'est pas sa forme canonique.
 *
 * Ce cas a fait tomber vingt et un tests au premier build Windows, et il aurait
 * rendu l'application muette chez une partie des utilisateurs. Le répertoire
 * temporaire du runner s'appelle `C:\Users\RUNNER~1\...` — un nom court 8.3 —
 * alors que `realpath` renvoie `C:\Users\runneradmin\...`. La racine était
 * comparée telle qu'elle avait été fournie, donc **tout** était refusé : ni
 * overlay, ni panneau, ni assistant, et un 404 sans explication.
 *
 * Le lien symbolique reproduit exactement cet écart sous Linux : la racine
 * désigne le bon répertoire par un chemin qui n'est pas celui que `realpath`
 * rend. Windows a d'autres façons d'y arriver — noms courts, jonctions,
 * `%TEMP%` redirigé — mais le défaut est le même, et c'est celui-ci qu'il faut
 * tenir.
 */
describe('createStaticHandler — racine non canonique', () => {
  let base: string;
  let handler: StaticHandler;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'chronocast-static-lien-'));

    const real = join(base, 'reel');
    await mkdir(join(real, 'overlay'), { recursive: true });
    await writeFile(join(real, 'overlay', 'index.html'), '<!doctype html><p>overlay</p>', 'utf8');

    // La racine passée au gestionnaire n'est pas la forme canonique du
    // répertoire : c'est un autre chemin qui y mène.
    const alias = join(base, 'alias');
    await symlink(real, alias, 'dir');

    handler = createStaticHandler({
      rootDirectory: alias,
      logger: createLogger({ level: 'debug', sinks: [createMemorySink()] }),
    });
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('sert les fichiers de la racine malgré tout', async () => {
    const response = await handler.serve('/overlay/index.html');

    expect(response.status).toBe(200);
    expect(response.body.toString()).toContain('overlay');
  });

  it('refuse toujours ce qui sort de la racine', async () => {
    // La correction ne doit pas se payer d'un relâchement de la garde : élargir
    // ce qui est accepté est précisément le risque quand on assouplit une
    // comparaison de chemins.
    const response = await handler.serve('/../../etc/passwd.json');

    expect(response.status).toBe(404);
  });
});
