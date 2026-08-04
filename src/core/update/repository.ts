/**
 * Dépôt d'où viennent les mises à jour.
 *
 * Une constante et non un réglage, délibérément. Rendre la source configurable
 * offrirait à qui saurait écrire dans le fichier de configuration la capacité
 * de faire télécharger et lancer un exécutable arbitraire — c'est-à-dire
 * transformerait un réglage en exécution de code. Le contrôle d'URL de
 * `release-feed.ts` s'appuie sur ces deux valeurs : les rendre variables le
 * viderait de son sens.
 */
export const UPDATE_REPOSITORY = {
  owner: 'thedevopser',
  repo: 'ChronoCast',
} as const;
