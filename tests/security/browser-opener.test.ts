import { describe, expect, it, vi } from 'vitest';

import { createExternalBrowserOpener } from '../../src/main/browser-opener.js';

/**
 * Ouverture d'une URL dans le navigateur du système.
 *
 * C'est une capacité sensible, et le contrat du port l'énonce : tout schéma
 * autre que `https:` doit être refusé. Sous Electron, `shell.openExternal`
 * demande au système d'exploitation d'ouvrir ce qu'on lui donne — un
 * `file://` ouvre l'explorateur, et d'autres schémas déclenchent des
 * applications enregistrées par des tiers.
 *
 * L'unique appelant légitime est le flux OAuth, qui construit lui-même une URL
 * `https://id.twitch.tv/...`. La garde ne protège donc pas d'un appelant
 * hostile : elle empêche qu'une URL d'origine douteuse atteigne un jour cet
 * appel parce que quelqu'un aura élargi le chemin sans y penser.
 */
/**
 * Compose une URL à partir de son schéma et du reste.
 *
 * Écrire `javascript:` en littéral est interdit par ESLint — `no-script-url` —
 * et la règle vaut aussi dans les tests. La contourner par une désactivation
 * locale reviendrait à s'autoriser ce qu'on interdit ailleurs ; la composer est
 * la même discipline que celle appliquée aux caractères de contrôle, décrits
 * par leur code plutôt qu'écrits tels quels.
 */
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
    // Comparer par préfixe de chaîne refuserait `HTTPS://`, qui est pourtant
    // une URL parfaitement valide : c'est l'analyse qui fait foi, pas la forme.
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
    // Le contrat du port renvoie une promesse. Lever synchroniquement ferait
    // passer l'erreur à côté du `.catch()` de l'appelant, et un flux OAuth
    // interrompu deviendrait un plantage.
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
    // Si le navigateur ne s'ouvre pas, l'assistant doit pouvoir afficher l'URL
    // à copier plutôt que d'attendre indéfiniment une autorisation qui ne
    // viendra pas.
    const opener = createExternalBrowserOpener({
      openExternal: vi.fn().mockRejectedValue(new Error('aucun navigateur enregistré')),
    });

    await expect(opener.open('https://id.twitch.tv/')).rejects.toThrow(
      /aucun navigateur enregistré/,
    );
  });
});
