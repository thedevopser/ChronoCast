/**
 * Comparaison de versions.
 *
 * Premier des deux verrous de la mise à jour — le second est le condensat. Il
 * répond à une seule question : l'artefact publié est-il *strictement* plus
 * récent que ce qui tourne ici ?
 *
 * Ce n'est pas une implémentation de SemVer, et cela ne doit pas le devenir. La
 * grammaire acceptée est délibérément étroite : trois nombres, un point de
 * séparation, un `v` facultatif en tête. Le dépôt ne publie que des tags de
 * cette forme, et tolérer une pré-version reviendrait à pousser une bêta sur
 * tous les postes le jour où quelqu'un en publierait une par mégarde.
 *
 * La comparaison est numérique et non lexicographique. C'est la raison d'être
 * du module : `'0.9.0' > '0.10.0'` en texte, si bien qu'une comparaison de
 * chaînes bloquerait dix ans de correctifs sans jamais rien signaler.
 */

export interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/**
 * Trois composantes, rien d'autre, ancrées aux deux extrémités.
 *
 * Le zéro initial est refusé — `01.2.3` n'est pas une version, c'est une faute
 * de frappe qui se comparerait comme `1.2.3` sans jamais s'annoncer.
 */
const VERSION_PATTERN = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Lit une version. Renvoie `null` sur toute forme qui n'est pas exactement attendue. */
export function parseVersion(text: string): Version | null {
  const match = VERSION_PATTERN.exec(text);
  if (match === null) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/** Ordonne deux versions : `-1`, `0` ou `1`, comme un comparateur de tri. */
export function compareVersions(a: Version, b: Version): -1 | 0 | 1 {
  if (a.major !== b.major) {
    return a.major > b.major ? 1 : -1;
  }
  if (a.minor !== b.minor) {
    return a.minor > b.minor ? 1 : -1;
  }
  if (a.patch !== b.patch) {
    return a.patch > b.patch ? 1 : -1;
  }
  return 0;
}

/**
 * Le candidat mérite-t-il d'être installé ?
 *
 * Toute forme illisible — des deux côtés — vaut « non ». Ne pas comprendre sa
 * propre version et mettre à jour quand même reviendrait à accepter n'importe
 * quel artefact : le refus est le seul comportement sûr, et il se traduit au
 * pire par une mise à jour qu'on fera à la main.
 */
export function isNewer(candidate: string, current: string): boolean {
  const parsedCandidate = parseVersion(candidate);
  const parsedCurrent = parseVersion(current);

  if (parsedCandidate === null || parsedCurrent === null) {
    return false;
  }

  return compareVersions(parsedCandidate, parsedCurrent) === 1;
}
