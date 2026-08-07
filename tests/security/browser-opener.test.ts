import { describe, expect, it, vi } from 'vitest';

import { createExternalBrowserOpener } from '../../src/main/browser-opener.js';

function withScheme(scheme: string, rest: string): string {
  return `${scheme}:${rest}`;
}

describe('createExternalBrowserOpener', () => {
  it('ouvre une URL https', async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const opener = createExternalBrowserOpener({ openExternal });

    await opener.open('https://id.twitch.tv/oauth2/authorize?client_id=abc');

    expect(openExternal).toHaveBeenCalledWith('https://id.twitch.tv/oauth2/authorize?client_id=abc');
  });

  it('accepte la casse du schéma, que les navigateurs ignorent', async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const opener = createExternalBrowserOpener({ openExternal });

    await opener.open('HTTPS://id.twitch.tv/');

    expect(openExternal).toHaveBeenCalledTimes(1);
  });

  describe('schémas refusés', () => {
    const hostiles = [
      ['http://id.twitch.tv/', 'en clair, donc interceptable'],
      [withScheme('javascript', 'alert(1)'), 'exécution de code'],
      [withScheme('data', 'text/html,<script>alert(1)</script>'), 'contenu embarqué'],
      ['file:///C:/Windows/System32/', 'ouvre l’explorateur de fichiers'],
      ['ms-msdt:/id', 'protocole système enregistré par un tiers'],
      [withScheme('vbscript', 'msgbox(1)'), 'exécution de code'],
      ['ftp://exemple.test/', 'schéma sans rapport'],
      ['//id.twitch.tv/', 'URL relative au protocole, non analysable seule'],
      ['pas une url', 'chaîne quelconque'],
      ['', 'chaîne vide'],
    ] as const;

    it.each(hostiles)('refuse %s (%s)', async (url) => {
      const openExternal = vi.fn().mockResolvedValue(undefined);
      const opener = createExternalBrowserOpener({ openExternal });

      await expect(opener.open(url)).rejects.toThrow();
      expect(openExternal).not.toHaveBeenCalled();
    });
  });

  it('rejette au lieu de lever de façon synchrone', () => {
    const opener = createExternalBrowserOpener({
      openExternal: vi.fn().mockResolvedValue(undefined),
    });

    let result: Promise<void> | undefined;
    expect(() => {
      result = opener.open(withScheme('javascript', 'alert(1)'));
    }).not.toThrow();

    return expect(result).rejects.toThrow();
  });

  it('propage un échec du système', async () => {
    const opener = createExternalBrowserOpener({
      openExternal: vi.fn().mockRejectedValue(new Error('aucun navigateur enregistré')),
    });

    await expect(opener.open('https://id.twitch.tv/')).rejects.toThrow(
      /aucun navigateur enregistré/,
    );
  });
});
