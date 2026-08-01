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

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'chronocast-pages-'));
    const root = join(base, 'public');

    for (const page of ['overlay', 'admin', 'setup']) {
      await mkdir(join(root, page), { recursive: true });
      await writeFile(
        join(root, page, 'index.html'),
        `<!doctype html><meta name="chronocast-csrf" content="${CSRF_PLACEHOLDER}"><title>${page}</title>`,
        'utf8',
      );
    }

    handler = createPageHandler({
      staticHandler: createStaticHandler({
        rootDirectory: root,
        logger: createLogger({ level: 'error', sinks: [SILENT_SINK] }),
      }),
      getCsrfToken: () => TOKEN,
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

  it('redirige la racine vers le panneau d’administration', async () => {
    const response = await handler.serve('/');

    expect(response?.status).toBe(302);
    expect(response?.headers['location']).toBe('/admin');
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
