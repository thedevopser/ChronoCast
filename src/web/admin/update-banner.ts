/**
 * Ce que le panneau dit d'une mise à jour, et ce qu'il propose d'en faire.
 *
 * Modèle pur : il ne connaît ni le DOM ni le réseau, seulement l'état du
 * service et celui du compteur. C'est ce qui permet d'éprouver la règle qui
 * compte — **on avertit avant d'installer pendant un direct** — sans monter une
 * page.
 *
 * Le bandeau se tait la plupart du temps, et c'est délibéré. Une barre
 * permanente annonçant « vous êtes à jour » n'apprend rien et prend la place de
 * ce qui compterait. Il n'apparaît que sur les deux états où l'utilisateur a
 * quelque chose à faire : une version vérifiée qui attend son clic, ou un échec
 * qu'il vaut mieux savoir.
 */

import type { UpdateStatus } from '../shared/protocol.js';

/** Nature du message, qui décide de la couleur et de rien d'autre. */
export type UpdateBannerTone = 'update' | 'error';

/** Ce que propose le bouton, ou `null` s'il n'y a rien à proposer. */
export type UpdateBannerAction = 'install' | 'retry';

export interface UpdateBannerModel {
  readonly tone: UpdateBannerTone;
  readonly text: string;
  readonly action: UpdateBannerAction;
  readonly actionLabel: string;
  /** Version proposée, quand il y en a une. */
  readonly version: string | null;
  /** Page des notes de version, quand elle est connue. */
  readonly notesUrl: string | null;
  /**
   * Le clic doit-il être confirmé ?
   *
   * Vrai quand le compteur tourne. Installer ferme l'application : le faire
   * d'un clic distrait pendant un subathon coûterait le direct.
   */
  readonly requiresConfirmation: boolean;
  /** Texte de la seconde étape. Vide quand aucune confirmation n'est demandée. */
  readonly confirmText: string;
}

export interface UpdateBannerInputs {
  /** Le compteur est-il en train de décompter ? */
  readonly counterRunning: boolean;
}

export function updateBannerModel(
  status: UpdateStatus,
  inputs: UpdateBannerInputs,
): UpdateBannerModel | null {
  if (status.phase === 'ready' && status.availableVersion !== null) {
    return {
      tone: 'update',
      text: `ChronoCast ${status.availableVersion} est disponible et vérifié.`,
      action: 'install',
      actionLabel: 'Installer maintenant',
      version: status.availableVersion,
      notesUrl: status.notesUrl,
      requiresConfirmation: inputs.counterRunning,
      confirmText: inputs.counterRunning
        ? // Ce que l'utilisateur n'a aucun moyen de deviner, et la seule chose
          // qui puisse légitimement le faire hésiter.
          'Le compteur tourne. ChronoCast va se fermer, l’installeur s’ouvrira, puis le compteur reprendra où il en est. Confirmer ?'
        : '',
    };
  }

  if (status.phase === 'error') {
    return {
      tone: 'error',
      // `message` peut être absent : afficher « null » serait pire que se
      // taire, et se taire tout court cacherait un échec réel.
      text: status.message ?? 'La vérification des mises à jour a échoué.',
      action: 'retry',
      actionLabel: 'Réessayer',
      version: null,
      notesUrl: null,
      requiresConfirmation: false,
      confirmText: '',
    };
  }

  // `idle`, `checking`, `downloading`, `disabled` et `unsupported` : rien à
  // dire. Le téléchargement en particulier reste silencieux — annoncer une
  // version qu'on n'a pas encore vérifiée reviendrait à promettre ce qu'on
  // pourrait devoir retirer.
  return null;
}
