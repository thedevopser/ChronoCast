import { describe, expect, it } from 'vitest';

import { INSTALLER_PREFIX, selectUpdate } from '../../../src/core/update/release-feed.js';
import {
  OWNER,
  REPO,
  downloadUrl,
  githubRelease,
  releaseAssets,
  type FakeAsset,
  type FakeRelease,
} from '../../fixtures/github-release.js';

/**
 * Du JSON de GitHub au candidat de mise à jour.
 *
 * Ce module est la frontière : au-delà, plus rien ne remet en question ce qu'il
 * a laissé passer. Il décide donc de tout ce qui peut se décider sans réseau —
 * la version est-elle plus récente, l'artefact porte-t-il le nom attendu, son
 * URL pointe-t-elle bien vers ce dépôt — et il le fait sur du JSON venu du
 * réseau, c'est-à-dire sur du contenu qu'il faut traiter comme hostile.
 *
 * Le contrôle de l'URL est le moins intuitif et le plus important : sans lui,
 * une réponse d'API contrefaite ferait télécharger un exécutable arbitraire. Le
 * condensat le rattraperait — il est publié sur GitHub, donc hors de portée de
 * qui aurait détourné la réponse — mais faire reposer toute la sécurité sur un
 * seul contrôle, c'est n'en avoir aucun le jour où il se révèle faux.
 */

const CURRENT = '0.5.0';

const select = (payload: unknown, currentVersion = CURRENT) =>
  selectUpdate({ payload, currentVersion, owner: OWNER, repo: REPO });

/** Position des deux artefacts dans la release de référence. */
const INSTALLER = 0;
const DIGEST = 1;

/** Abîme un seul artefact, pour que le test ne montre que ce qui le distingue. */
function patchAsset(release: FakeRelease, index: number, patch: Partial<FakeAsset>): FakeRelease {
  return {
    ...release,
    assets: release.assets.map((asset, position) => (position === index ? { ...asset, ...patch } : asset)),
  };
}

describe('selectUpdate', () => {
  describe('cas nominal', () => {
    it('retient la release et ses deux artefacts', () => {
      const result = select(githubRelease('0.5.1'));

      expect(result).toEqual({
        kind: 'update',
        candidate: {
          version: '0.5.1',
          tag: 'v0.5.1',
          installerName: 'ChronoCast-Setup-0.5.1.exe',
          installerUrl: downloadUrl('v0.5.1', 'ChronoCast-Setup-0.5.1.exe'),
          digestUrl: downloadUrl('v0.5.1', 'ChronoCast-Setup-0.5.1.exe.sha256'),
          sizeBytes: 100_663_296,
          notesUrl: `https://github.com/${OWNER}/${REPO}/releases/tag/v0.5.1`,
        },
      });
    });

    it('nomme l’installeur d’après la version du tag, pas d’après l’asset', () => {
      // Le nom attendu se déduit de la version ; on cherche cet asset-là, on ne
      // prend pas le premier `.exe` venu. Un artefact étranger déposé sur la
      // release ne doit pas pouvoir se substituer à l'installeur.
      const release = githubRelease('0.5.1');
      release.assets.unshift({
        name: 'autre-chose.exe',
        size: 10,
        browser_download_url: downloadUrl('v0.5.1', 'autre-chose.exe'),
      });

      const result = select(release);

      expect(result).toMatchObject({
        kind: 'update',
        candidate: { installerName: `${INSTALLER_PREFIX}0.5.1.exe` },
      });
    });
  });

  describe('rien à faire', () => {
    it('annonce l’application à jour quand les versions sont égales', () => {
      expect(select(githubRelease('0.5.0'))).toEqual({ kind: 'up-to-date' });
    });

    it('annonce l’application à jour quand la release est plus ancienne', () => {
      expect(select(githubRelease('0.4.0'))).toEqual({ kind: 'up-to-date' });
    });
  });

  describe('charges utiles refusées', () => {
    const rejected = (payload: unknown, currentVersion = CURRENT) => {
      const result = select(payload, currentVersion);
      expect(result.kind).toBe('rejected');
      return result;
    };

    it('refuse ce qui n’est pas un objet', () => {
      rejected('<html>rate limit exceeded</html>');
    });

    it('refuse une charge utile sans assets', () => {
      rejected({ tag_name: 'v0.5.1', html_url: 'https://github.com/x' });
    });

    it('refuse un tag mal formé', () => {
      rejected(githubRelease('0.5.1', { tag_name: 'derniere-version' }));
    });

    it('refuse une pré-version', () => {
      // `/releases/latest` n'en renvoie pas, mais le champ existe et coûte une
      // ligne à vérifier : une bêta poussée sur tous les postes serait le
      // genre d'incident qu'on ne rattrape pas.
      rejected(githubRelease('0.6.0', { prerelease: true }));
    });

    it('refuse un brouillon', () => {
      rejected(githubRelease('0.6.0', { draft: true }));
    });

    it('refuse une release sans installeur', () => {
      const release = githubRelease('0.5.1');
      release.assets = release.assets.filter((asset) => !asset.name.endsWith('.exe'));
      rejected(release);
    });

    it('refuse une release sans condensat', () => {
      // Sans le `.sha256`, il n'y a rien à quoi confronter le fichier : mieux
      // vaut ne pas mettre à jour que lancer un exécutable non vérifié.
      const release = githubRelease('0.5.1');
      release.assets = release.assets.filter((asset) => !asset.name.endsWith('.sha256'));
      rejected(release);
    });

    it('refuse un installeur dont la taille est absurde', () => {
      rejected(patchAsset(githubRelease('0.5.1'), INSTALLER, { size: 0 }));
    });

    it('refuse un installeur hébergé ailleurs que sur github.com', () => {
      rejected(
        patchAsset(githubRelease('0.5.1'), INSTALLER, {
          browser_download_url:
            'https://github.evil.test/thedevopser/ChronoCast/releases/download/v0.5.1/ChronoCast-Setup-0.5.1.exe',
        }),
      );
    });

    it('refuse un installeur venu d’un autre dépôt', () => {
      rejected(
        patchAsset(githubRelease('0.5.1'), INSTALLER, {
          browser_download_url:
            'https://github.com/quelquun/ailleurs/releases/download/v0.5.1/ChronoCast-Setup-0.5.1.exe',
        }),
      );
    });

    it('refuse un installeur rattaché à un autre tag', () => {
      rejected(
        patchAsset(githubRelease('0.5.1'), INSTALLER, {
          browser_download_url: downloadUrl('v9.9.9', 'ChronoCast-Setup-0.5.1.exe'),
        }),
      );
    });

    it('refuse un condensat détourné, même si l’installeur est légitime', () => {
      // Détourner le seul condensat suffirait : il décide de ce que l'on juge
      // authentique.
      rejected(
        patchAsset(githubRelease('0.5.1'), DIGEST, {
          browser_download_url: 'https://exemple.test/ChronoCast-Setup-0.5.1.exe.sha256',
        }),
      );
    });

    it('refuse une URL en clair', () => {
      rejected(
        patchAsset(githubRelease('0.5.1'), INSTALLER, {
          browser_download_url: downloadUrl('v0.5.1', 'ChronoCast-Setup-0.5.1.exe').replace('https:', 'http:'),
        }),
      );
    });

    it('refuse une URL portant un identifiant avant l’hôte', () => {
      // `https://github.com@evil.test/...` : l'usurpation la plus lisible, et
      // celle qui passe une comparaison de préfixe.
      rejected(
        patchAsset(githubRelease('0.5.1'), INSTALLER, {
          browser_download_url:
            'https://github.com@evil.test/thedevopser/ChronoCast/releases/download/v0.5.1/ChronoCast-Setup-0.5.1.exe',
        }),
      );
    });

    it('refuse un nom d’asset porteur d’un séparateur de chemin', () => {
      // Le nom sert à composer un chemin de fichier local : un séparateur y
      // ferait sortir l'écriture du répertoire des mises à jour.
      const tag = 'v0.5.1';
      const release = githubRelease('0.5.1', {
        assets: [
          {
            name: '../ChronoCast-Setup-0.5.1.exe',
            size: 1_000,
            browser_download_url: downloadUrl(tag, '../ChronoCast-Setup-0.5.1.exe'),
          },
          ...releaseAssets('0.5.1'),
        ],
      });

      // L'asset légitime reste présent : le test vérifie qu'on retient celui-ci
      // et non l'autre, et non qu'on refuse toute la release.
      expect(select(release)).toMatchObject({
        kind: 'update',
        candidate: { installerName: 'ChronoCast-Setup-0.5.1.exe' },
      });
    });

    it('refuse quand la version courante est illisible', () => {
      rejected(githubRelease('0.5.1'), 'inconnue');
    });
  });

  describe('robustesse aux clés hostiles', () => {
    it('ignore une clé `__proto__` sans polluer le prototype', () => {
      const payload = JSON.parse(
        JSON.stringify({ ...githubRelease('0.5.1'), __proto__: { pollue: true } }),
      ) as unknown;

      select(payload);

      expect(({} as Record<string, unknown>)['pollue']).toBeUndefined();
    });

    it('écarte les champs inconnus plutôt que de rejeter la release', () => {
      // GitHub ajoute des champs à son API sans prévenir ; les refuser
      // bloquerait toutes les mises à jour le jour où cela arrive.
      const release = { ...githubRelease('0.5.1'), un_champ_ajoute_demain: 42 };

      expect(select(release).kind).toBe('update');
    });
  });
});
