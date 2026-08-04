/**
 * De la charge utile de GitHub au candidat de mise à jour.
 *
 * Ce module est la frontière : au-delà, plus rien ne remet en question ce qu'il
 * a laissé passer. Il tranche donc tout ce qui se tranche sans réseau — la
 * version est-elle plus récente, l'artefact porte-t-il le nom attendu, son URL
 * mène-t-elle bien à ce dépôt — et il le fait sur du JSON venu d'Internet,
 * c'est-à-dire sur du contenu à traiter comme hostile. Zod l'y aide, comme pour
 * toute charge utile externe du projet.
 *
 * **Le contrôle de l'URL est le moins intuitif et le plus important.** Sans
 * lui, une réponse d'API contrefaite ferait télécharger un exécutable
 * arbitraire. Le condensat le rattraperait, puisqu'il est publié sur GitHub et
 * donc hors de portée de qui aurait détourné la réponse — mais faire reposer
 * toute la sécurité sur un contrôle unique, c'est n'en avoir aucun le jour où
 * il se révèle faux.
 */

import { z } from 'zod';

import { isNewer, parseVersion } from './semver.js';

/**
 * Préfixe du nom de l'installeur.
 *
 * Il vient de l'`artifactName` d'electron-builder — `ChronoCast-Setup-${version}.${ext}`.
 * Les deux doivent rester accordés : un renommage dans la configuration de
 * packaging rendrait toutes les releases suivantes invisibles à l'updater, sans
 * la moindre erreur. Un test tient les deux ensemble.
 */
export const INSTALLER_PREFIX = 'ChronoCast-Setup-';

/** Extension du fichier de condensat, telle que le workflow `Release` la produit. */
export const DIGEST_SUFFIX = '.sha256';

/** Taille en deçà de laquelle un installeur annoncé ne peut pas être vrai. */
const MIN_INSTALLER_BYTES = 1_000_000;

/** Ce qu'il faut savoir pour télécharger et vérifier une version. */
export interface UpdateCandidate {
  /** Version nue, sans le `v` du tag. */
  readonly version: string;
  readonly tag: string;
  /** Nom de fichier, qui sert aussi de nom local — d'où le contrôle des séparateurs. */
  readonly installerName: string;
  readonly installerUrl: string;
  readonly digestUrl: string;
  readonly sizeBytes: number;
  /** Page de la release, pour que l'utilisateur puisse lire les notes. */
  readonly notesUrl: string;
}

/**
 * Issue de l'examen d'une release.
 *
 * Trois cas et non deux : « rien de neuf » et « quelque chose ne va pas » ne
 * s'affichent pas pareil et ne se journalisent pas pareil. Les confondre ferait
 * passer une release malformée pour une application à jour, c'est-à-dire
 * masquerait le défaut au lieu de le dire.
 */
export type UpdateSelection =
  | { readonly kind: 'update'; readonly candidate: UpdateCandidate }
  | { readonly kind: 'up-to-date' }
  | { readonly kind: 'rejected'; readonly reason: string };

/**
 * Forme de la réponse, réduite à ce dont dépend la décision.
 *
 * `.strip()` et non `.strict()` : GitHub ajoute des champs à son API sans
 * prévenir, et les refuser bloquerait toutes les mises à jour le jour où cela
 * arrive. C'est le même arbitrage que pour le schéma de configuration.
 */
const assetSchema = z
  .object({
    name: z.string(),
    size: z.number().int().nonnegative(),
    browser_download_url: z.string(),
  })
  .strip();

const releaseSchema = z
  .object({
    tag_name: z.string(),
    html_url: z.string(),
    draft: z.boolean().default(false),
    prerelease: z.boolean().default(false),
    assets: z.array(assetSchema),
  })
  .strip();

export interface SelectUpdateOptions {
  /** Charge utile brute, telle que `response.json()` l'a rendue. */
  readonly payload: unknown;
  /** Version en cours d'exécution. */
  readonly currentVersion: string;
  readonly owner: string;
  readonly repo: string;
}

export function selectUpdate(options: SelectUpdateOptions): UpdateSelection {
  const { payload, currentVersion, owner, repo } = options;

  const parsed = releaseSchema.safeParse(payload);
  if (!parsed.success) {
    return { kind: 'rejected', reason: 'charge utile inattendue' };
  }

  const release = parsed.data;

  if (release.draft || release.prerelease) {
    // `/releases/latest` n'en renvoie pas. Le vérifier coûte une ligne, et une
    // bêta poussée sur tous les postes est le genre d'incident qu'on ne
    // rattrape pas.
    return { kind: 'rejected', reason: 'release non publiée' };
  }

  const version = parseVersion(release.tag_name);
  if (version === null) {
    return { kind: 'rejected', reason: `tag illisible : ${release.tag_name}` };
  }

  if (parseVersion(currentVersion) === null) {
    // Ne pas comprendre sa propre version et mettre à jour quand même
    // reviendrait à accepter n'importe quel artefact.
    return { kind: 'rejected', reason: 'version courante illisible' };
  }

  if (!isNewer(release.tag_name, currentVersion)) {
    return { kind: 'up-to-date' };
  }

  const plain = `${String(version.major)}.${String(version.minor)}.${String(version.patch)}`;
  const installerName = `${INSTALLER_PREFIX}${plain}.exe`;
  const digestName = `${installerName}${DIGEST_SUFFIX}`;

  // On cherche l'asset qui porte le nom attendu ; on ne prend pas le premier
  // `.exe` venu. Un artefact étranger déposé sur la release ne doit pas pouvoir
  // se substituer à l'installeur.
  const installer = release.assets.find((asset) => asset.name === installerName);
  if (installer === undefined) {
    return { kind: 'rejected', reason: `installeur absent : ${installerName}` };
  }

  const digest = release.assets.find((asset) => asset.name === digestName);
  if (digest === undefined) {
    // Sans le `.sha256`, il n'y a rien à quoi confronter le fichier. Mieux vaut
    // ne pas mettre à jour que lancer un exécutable non vérifié.
    return { kind: 'rejected', reason: `condensat absent : ${digestName}` };
  }

  if (installer.size < MIN_INSTALLER_BYTES) {
    return { kind: 'rejected', reason: 'taille d’installeur invraisemblable' };
  }

  const expectedPrefix = `/${owner}/${repo}/releases/download/${release.tag_name}/`;

  if (!isRepositoryDownload(installer.browser_download_url, `${expectedPrefix}${installerName}`)) {
    return { kind: 'rejected', reason: 'URL d’installeur étrangère au dépôt' };
  }

  if (!isRepositoryDownload(digest.browser_download_url, `${expectedPrefix}${digestName}`)) {
    // Détourner le seul condensat suffirait : c'est lui qui décide de ce que
    // l'on tient pour authentique.
    return { kind: 'rejected', reason: 'URL de condensat étrangère au dépôt' };
  }

  return {
    kind: 'update',
    candidate: {
      version: plain,
      tag: release.tag_name,
      installerName,
      installerUrl: installer.browser_download_url,
      digestUrl: digest.browser_download_url,
      sizeBytes: installer.size,
      notesUrl: release.html_url,
    },
  };
}

/**
 * L'URL mène-t-elle exactement à l'artefact attendu de ce dépôt ?
 *
 * L'URL est **analysée**, jamais comparée par préfixe : `https://github.com@evil.test/…`
 * commence par la bonne chaîne et ne va pas du tout au bon endroit. `hostname`
 * ignore l'identifiant qui précéderait une arobase, ce qui est justement
 * l'usurpation la plus lisible. C'est la même discipline que
 * `main/browser-opener.ts`, et pour la même raison.
 *
 * Le chemin est comparé en entier, et non par son début : il est entièrement
 * déterminé par le dépôt, le tag et le nom de l'asset, tous trois déjà connus.
 */
function isRepositoryDownload(rawUrl: string, expectedPath: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  return url.protocol === 'https:' && url.hostname === 'github.com' && url.pathname === expectedPath;
}
