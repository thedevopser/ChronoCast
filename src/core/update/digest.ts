/**
 * Condensat SHA-256 : le seul contrôle d'intégrité du chemin de mise à jour.
 *
 * L'installeur n'est pas signé — un certificat coûte plusieurs centaines
 * d'euros par an, ce que ce projet n'engage pas — et le fichier téléchargé par
 * le `fetch` de Node ne porte **aucune *Mark of the Web*** : Windows n'écrit ce
 * flux alternatif que lorsqu'un navigateur ou un client de messagerie dépose le
 * fichier. SmartScreen ne se déclenchera donc jamais sur ce que nous
 * téléchargeons, altéré ou non. Ce module est le dernier endroit où l'on peut
 * encore dire non.
 *
 * D'où la vérification du **nom** en même temps que celle du condensat : un
 * `.sha256` parfaitement valide mais décrivant un autre fichier validerait
 * n'importe quel téléchargement, et c'est précisément ce qu'obtiendrait
 * quiconque saurait substituer un asset à un autre.
 */

import { createHash } from 'node:crypto';

/** Condensat hexadécimal en minuscules, sur soixante-quatre caractères. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Une ligne de `sha256sum` : le condensat, un séparateur, le nom du fichier.
 *
 * Le séparateur est de deux espaces en mode texte et d'un espace suivi d'une
 * astérisque en mode binaire. Le workflow `Release` produit le premier ; le
 * second arrive dès que quelqu'un recalcule le condensat sous Windows, et le
 * refuser ne protégerait de rien.
 */
const DIGEST_LINE = /^([0-9a-fA-F]{64})[ \t]+\*?(.+)$/;

/**
 * Extrait le condensat de l'artefact demandé.
 *
 * Renvoie `null` dès que quoi que ce soit ne colle pas : fichier illisible,
 * condensat mal formé, ou — le cas qui compte — nom de fichier différent de
 * celui attendu. Il n'y a pas de demi-mesure ici : sans condensat sûr, on ne
 * lance rien.
 */
export function parseSha256File(content: string, expectedName: string): string | null {
  // `\r` est retiré ligne à ligne : le fichier est produit sous Linux par le
  // runner et lu sous Windows par l'application. C'est exactement la classe de
  // défaut qui a fait tomber trente-trois tests en Phase 7.
  for (const rawLine of content.split('\n')) {
    const match = DIGEST_LINE.exec(rawLine.replace(/\r$/, ''));
    if (match === null) {
      continue;
    }

    // Les deux groupes sont garantis par le motif, mais `noUncheckedIndexedAccess`
    // ne le sait pas : la garde est une formalité du typage, pas un cas réel.
    const [, digest, name] = match;
    if (digest === undefined || name === undefined) {
      continue;
    }

    if (name.trim() === expectedName) {
      return digest.toLowerCase();
    }
  }

  return null;
}
