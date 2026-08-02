/**
 * Feuille de style personnelle de l'overlay.
 *
 * `overlay.enableCustomCss` existe au schéma depuis la Phase 1 et n'a jamais eu
 * de route : `static-handler.ts` ne sert que la racine web, et rien ne lisait
 * le répertoire de données. Ce gestionnaire comble ce trou.
 *
 * Il sert **un seul fichier, à un seul chemin**. Aucun segment ne vient de
 * l'URL, ce qui retire d'emblée la traversée de chemin classique — mais pas le
 * lien symbolique, qui reste la vraie surface : le répertoire de données est
 * celui de l'utilisateur, et il y dépose ce qu'il veut. Un lien pointant vers
 * `tokens.json` ferait servir les jetons Twitch chiffrés au premier venu qui
 * ouvre l'overlay.
 *
 * Comme pour le gestionnaire statique, **toute erreur produit la même `404`**.
 * Un `403` distinct confirmerait l'existence du fichier visé.
 */

import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createLogger, type LogSink } from '../../../../src/core/logging/logger.js';
import {
  createCustomCssHandler,
  type CustomCssHandler,
} from '../../../../src/core/server/routes/custom-css.js';

const SILENT_SINK: LogSink = { name: 'silencieux', write: () => undefined };

describe('createCustomCssHandler', () => {
  let base: string;
  let dataDirectory: string;
  let handler: CustomCssHandler;
  let enabled: boolean;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'chronocast-css-'));
    dataDirectory = join(base, 'data');
    await mkdir(dataDirectory, { recursive: true });
    enabled = true;

    handler = createCustomCssHandler({
      dataDirectory,
      isEnabled: () => enabled,
      logger: createLogger({ level: 'error', sinks: [SILENT_SINK] }),
    });
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('renvoie null pour un chemin qui ne lui appartient pas', async () => {
    // Le routeur pourra alors essayer les pages puis le statique : ce
    // gestionnaire ne décide pas à leur place.
    expect(await handler.serve('/overlay')).toBeNull();
    expect(await handler.serve('/shared/theme.css')).toBeNull();
    expect(await handler.serve('/api/state')).toBeNull();
  });

  it('sert la feuille quand le réglage est actif', async () => {
    await writeFile(join(dataDirectory, 'custom.css'), '.countdown { color: red; }', 'utf8');

    const response = await handler.serve('/custom.css');

    expect(response?.status).toBe(200);
    expect(response?.headers['content-type']).toBe('text/css; charset=utf-8');
    expect(response?.body.toString()).toContain('color: red');
  });

  it('annonce la longueur du corps', async () => {
    const content = '.countdown { color: red; }';
    await writeFile(join(dataDirectory, 'custom.css'), content, 'utf8');

    const response = await handler.serve('/custom.css');

    expect(response?.headers['content-length']).toBe(String(Buffer.byteLength(content, 'utf8')));
  });

  it('interdit la mise en cache', async () => {
    // Le streamer modifie sa feuille et recharge sa Browser Source : lui
    // servir la version précédente lui ferait croire que rien ne fonctionne.
    await writeFile(join(dataDirectory, 'custom.css'), 'a{}', 'utf8');

    expect((await handler.serve('/custom.css'))?.headers['cache-control']).toBe('no-store');
  });

  it('répond 404 quand le réglage est inactif', async () => {
    await writeFile(join(dataDirectory, 'custom.css'), 'a{}', 'utf8');
    enabled = false;

    const response = await handler.serve('/custom.css');

    expect(response?.status).toBe(404);
    // Le fichier existe pourtant : la réponse ne doit pas le laisser deviner.
    expect(response?.body.toString()).not.toContain('custom');
  });

  it('répond 404 quand le fichier est absent', async () => {
    expect((await handler.serve('/custom.css'))?.status).toBe(404);
  });

  it('répond 404 quand le chemin désigne un répertoire', async () => {
    await mkdir(join(dataDirectory, 'custom.css'));

    expect((await handler.serve('/custom.css'))?.status).toBe(404);
  });

  it('refuse un lien symbolique sortant du répertoire de données', async () => {
    // La seule vraie surface de ce gestionnaire. Le répertoire de données est
    // celui de l'utilisateur, et `tokens.json` est son voisin immédiat.
    const secret = join(base, 'tokens.json');
    await writeFile(secret, '{"accessToken":"secret-a-ne-pas-servir"}', 'utf8');
    await symlink(secret, join(dataDirectory, 'custom.css'));

    const response = await handler.serve('/custom.css');

    expect(response?.status).toBe(404);
    expect(response?.body.toString()).not.toContain('secret-a-ne-pas-servir');
  });

  it('accepte un lien symbolique restant dans le répertoire de données', async () => {
    // Refuser tout lien serait excessif : le streamer peut légitimement ranger
    // ses variantes de thème côte à côte et pointer l'une d'elles.
    await writeFile(join(dataDirectory, 'theme-noel.css'), '.countdown{color:green}', 'utf8');
    await symlink(join(dataDirectory, 'theme-noel.css'), join(dataDirectory, 'custom.css'));

    const response = await handler.serve('/custom.css');

    expect(response?.status).toBe(200);
    expect(response?.body.toString()).toContain('green');
  });

  it('répond la même chose quelle que soit la cause du refus', async () => {
    // Fichier absent, réglage inactif, lien sortant : trois causes, une seule
    // réponse. Une différence dessinerait la carte du répertoire de données.
    const absent = await handler.serve('/custom.css');
    enabled = false;
    const inactive = await handler.serve('/custom.css');

    expect(inactive?.status).toBe(absent?.status);
    expect(inactive?.body.toString()).toBe(absent?.body.toString());
  });

  it('accepte une barre oblique finale', async () => {
    await writeFile(join(dataDirectory, 'custom.css'), 'a{}', 'utf8');

    expect((await handler.serve('/custom.css/'))?.status).toBe(200);
  });
});
