/**
 * Version de l'application, telle qu'annoncée aux clients.
 *
 * **Elle est écrite deux fois, ici et dans `package.json`, et c'est assumé.**
 *
 * Sous Electron, la version vient d'`app.getVersion()`, donc du manifeste — la
 * coquille n'a pas besoin de cette constante. Le point d'entrée headless, lui,
 * n'a pas de manifeste sous la main : il tourne depuis `dist/headless/`, où la
 * position de `package.json` dépend de la façon dont le code a été émis. Lire
 * le fichier à l'exécution ferait donc reposer une valeur d'affichage sur une
 * disposition de fichiers, ce qui casse silencieusement au premier changement
 * de build.
 *
 * La duplication est tenue par un test de cohérence, sur le modèle de
 * `productName` et d'`app.setName` : les deux valeurs doivent être modifiées
 * ensemble, et la suite refuse de passer sinon.
 */
export const APP_VERSION = '0.6.0';
