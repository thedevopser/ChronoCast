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
    const response = await handler.serve('/admin');
    expect(response?.headers['cache-control']).toContain('no-store');
  });

  it.each(['/overlay', '/admin', '/setup'])(
    'substitue le port du WebSocket dans %s',
    async (path) => {
      const body = (await handler.serve(path))?.body.toString() ?? '';

      expect(body).toContain('content="3778"');
      expect(body).not.toContain(WS_PORT_PLACEHOLDER);
    },
  );

  it("laisse l'overlay hors du régime « sans cache »", async () => {
    const response = await handler.serve('/overlay');

    expect(response?.headers['cache-control']).toBe('no-cache');
  });

  it('annonce une longueur cohérente avec le corps réécrit', async () => {
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
    setupCompleted = false;

    const response = await handler.serve('/');

    expect(response?.status).toBe(302);
    expect(response?.headers['location']).toBe('/setup');
  });

  it('accepte une barre oblique finale', async () => {
    expect((await handler.serve('/admin/'))?.status).toBe(200);
  });

  it('renvoie null pour un chemin qui ne lui appartient pas', async () => {
    expect(await handler.serve('/api/state')).toBeNull();
    expect(await handler.serve('/overlay/app.js')).toBeNull();
  });
});
