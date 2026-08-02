import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createLogger, type LogSink } from '../../../src/core/logging/logger.js';
import { CSRF_PLACEHOLDER } from '../../../src/core/server/security/csrf.js';
import { createStaticHandler } from '../../../src/core/server/static-handler.js';
import {
  createPageHandler,
  injectCsrfToken,
  WS_PORT_PLACEHOLDER,
  type PageHandler,
} from '../../../src/core/server/routes/pages.js';

/**
 * Trois pages, deux régimes.
 *
 * L'overlay est chargé par OBS, qui se contente de l'URL : il ne reçoit aucun
 * jeton, et n'en a pas besoin puisqu'il ne fait que lire. Le panneau
 * d'administration et l'assistant, eux, mutent l'état : le jeton leur est
 * substitué dans le HTML au moment où la page est servie.
 *
 * Le jeton voyage dans une balise `meta`, jamais dans un script en ligne. C'est ce
 * qui permet à la CSP de rester stricte : une seule exception `unsafe-inline`
 * accordée pour le confort annulerait la protection de l'overlay, qui affiche des
 * pseudos choisis par des inconnus.
 */

const SILENT_SINK: LogSink = { name: 'silencieux', write: () => undefined };
const TOKEN = 'a1b2c3'.repeat(10) + 'abcd';

describe('injectCsrfToken', () => {
  it('remplace le marqueur par le jeton', () => {
    const html = `<meta name="chronocast-csrf" content="${CSRF_PLACEHOLDER}">`;
    expect(injectCsrfToken(html, TOKEN)).toBe(`<meta name="chronocast-csrf" content="${TOKEN}">`);
  });

  it('remplace toutes les occurrences', () => {
    const html = `${CSRF_PLACEHOLDER}|${CSRF_PLACEHOLDER}`;
    expect(injectCsrfToken(html, TOKEN)).toBe(`${TOKEN}|${TOKEN}`);
  });

  it('laisse intact un document sans marqueur', () => {
    expect(injectCsrfToken('<p>rien</p>', TOKEN)).toBe('<p>rien</p>');
  });

  it("refuse d'injecter un jeton qui n'est pas hexadécimal", () => {
    // Le jeton est écrit tel quel dans un attribut HTML. Il est engendré par
    // `createCsrfToken` et donc toujours hexadécimal ; vérifier la forme ferme
    // définitivement la question d'une injection par ce chemin.
    expect(() => injectCsrfToken(CSRF_PLACEHOLDER, '"><script>alert(1)</script>')).toThrow();
    expect(() => injectCsrfToken(CSRF_PLACEHOLDER, '')).toThrow();
  });
});

describe('createPageHandler', () => {
  let base: string;
  let handler: PageHandler;
  let setupCompleted: boolean;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'chronocast-pages-'));
    const root = join(base, 'public');
    setupCompleted = true;

    for (const page of ['overlay', 'admin', 'setup']) {
      await mkdir(join(root, page), { recursive: true });
      await writeFile(
        join(root, page, 'index.html'),
        `<!doctype html><meta name="chronocast-csrf" content="${CSRF_PLACEHOLDER}">` +
          `<meta name="chronocast-ws-port" content="${WS_PORT_PLACEHOLDER}"><title>${page}</title>`,
        'utf8',
      );
    }

    handler = createPageHandler({
      staticHandler: createStaticHandler({
        rootDirectory: root,
        logger: createLogger({ level: 'error', sinks: [SILENT_SINK] }),
      }),
      getCsrfToken: () => TOKEN,
      getWsPort: () => 3_778,
      isSetupCompleted: () => setupCompleted,
    });
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it.each(['/overlay', '/admin', '/setup'])('sert %s', async (path) => {
    const response = await handler.serve(path);

    expect(response?.status).toBe(200);
    expect(response?.headers['content-type']).toBe('text/html; charset=utf-8');
  });

  it("n'injecte jamais le jeton dans l'overlay", async () => {
    // OBS charge l'URL de l'overlay et peut la partager par mégarde — capture
    // d'écran, exportation de scène. Le jeton n'a rien à y faire.
    const response = await handler.serve('/overlay');

    expect(response?.body.toString()).not.toContain(TOKEN);
    expect(response?.body.toString()).toContain(CSRF_PLACEHOLDER);
  });

  it.each(['/admin', '/setup'])('injecte le jeton dans %s', async (path) => {
    const response = await handler.serve(path);

    expect(response?.body.toString()).toContain(TOKEN);
    expect(response?.body.toString()).not.toContain(CSRF_PLACEHOLDER);
  });

  it("interdit la mise en cache des pages porteuses du jeton", async () => {
    // Un jeton mis en cache survivrait au redémarrage qui l'a invalidé, et la
    // page semblerait fonctionner tout en échouant sur chaque mutation.
    const response = await handler.serve('/admin');
    expect(response?.headers['cache-control']).toContain('no-store');
  });

  it.each(['/overlay', '/admin', '/setup'])(
    'substitue le port du WebSocket dans %s',
    async (path) => {
      // Sur les trois pages, overlay compris : ce n'est pas un secret,
      // contrairement au jeton, et c'est l'overlay qui en a le plus besoin —
      // il n'a aucune autre voie pour interroger le serveur avant de se
      // connecter.
      const body = (await handler.serve(path))?.body.toString() ?? '';

      expect(body).toContain('content="3778"');
      expect(body).not.toContain(WS_PORT_PLACEHOLDER);
    },
  );

  it("laisse l'overlay hors du régime « sans cache »", async () => {
    // Réécrire le corps de l'overlay ne doit pas lui faire perdre son
    // `no-cache` d'origine au profit du `no-store` réservé aux pages à jeton.
    const response = await handler.serve('/overlay');

    expect(response?.headers['cache-control']).toBe('no-cache');
  });

  it('annonce une longueur cohérente avec le corps réécrit', async () => {
    // La substitution change la taille du document. Un `content-length` hérité
    // du fichier d'origine tronquerait la page ou ferait attendre le client.
    for (const path of ['/overlay', '/admin', '/setup']) {
      const response = await handler.serve(path);
      const body = response?.body.toString() ?? '';

      expect(response?.headers['content-length']).toBe(String(Buffer.byteLength(body, 'utf8')));
    }
  });

  it('redirige la racine vers le panneau une fois la configuration terminée', async () => {
    const response = await handler.serve('/');

    expect(response?.status).toBe(302);
    expect(response?.headers['location']).toBe('/admin');
  });

  it("redirige la racine vers l'assistant tant que la configuration n'est pas faite", async () => {
    // Un nouvel utilisateur doit tomber sur l'assistant, pas sur un panneau
    // qu'il ne peut pas encore remplir : sans jeton Twitch, le panneau n'a
    // rien à montrer et rien à commander.
    setupCompleted = false;

    const response = await handler.serve('/');

    expect(response?.status).toBe(302);
    expect(response?.headers['location']).toBe('/setup');
  });

  it('accepte une barre oblique finale', async () => {
    expect((await handler.serve('/admin/'))?.status).toBe(200);
  });

  it('renvoie null pour un chemin qui ne lui appartient pas', async () => {
    // Le routeur pourra alors essayer l'API puis les ressources statiques : la
    // page ne décide pas à leur place.
    expect(await handler.serve('/api/state')).toBeNull();
    expect(await handler.serve('/overlay/app.js')).toBeNull();
  });
});
