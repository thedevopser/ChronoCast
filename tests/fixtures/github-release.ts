/**
 * Charge utile de l'API GitHub, telle que `GET /repos/{owner}/{repo}/releases/latest`
 * la renvoie réellement.
 *
 * Reproduite d'après la release `v0.4.0` du dépôt, champs inutiles retirés. Ce
 * qui est conservé est exactement ce que `release-feed.ts` lit : l'inventer
 * plus riche donnerait l'illusion de couvrir des champs dont rien ne dépend.
 *
 * Les fabriques prennent des surcharges parce que la moitié des cas à couvrir
 * sont des charges utiles *abîmées* — asset manquant, URL détournée, tag mal
 * formé — et qu'écrire chacune en entier rendrait invisible le seul détail qui
 * les distingue.
 */

export const OWNER = 'thedevopser';
export const REPO = 'ChronoCast';

export interface FakeAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

export interface FakeRelease {
  tag_name: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  assets: FakeAsset[];
}

/** URL de téléchargement légitime, telle que GitHub la compose. */
export function downloadUrl(tag: string, name: string): string {
  return `https://github.com/${OWNER}/${REPO}/releases/download/${tag}/${name}`;
}

/** Les deux artefacts que le workflow `Release` attache à chaque publication. */
export function releaseAssets(version: string, tag = `v${version}`): FakeAsset[] {
  const installer = `ChronoCast-Setup-${version}.exe`;

  return [
    { name: installer, size: 100_663_296, browser_download_url: downloadUrl(tag, installer) },
    { name: `${installer}.sha256`, size: 91, browser_download_url: downloadUrl(tag, `${installer}.sha256`) },
  ];
}

export function githubRelease(version = '0.5.1', overrides: Partial<FakeRelease> = {}): FakeRelease {
  const tag = `v${version}`;

  return {
    tag_name: tag,
    html_url: `https://github.com/${OWNER}/${REPO}/releases/tag/${tag}`,
    draft: false,
    prerelease: false,
    assets: releaseAssets(version, tag),
    ...overrides,
  };
}
